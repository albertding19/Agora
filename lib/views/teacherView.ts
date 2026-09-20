/**
 * Teacher / projector view model. The projector page renders this with the
 * controls hidden, so the price rules below are what the big screen obeys:
 *
 *   blind       submission count only (no price anywhere)
 *   snapshot    blind price, histogram, groups, clusters when ready
 *   structured  same, plus turn timers
 *   open        live price and price history
 *   resolved    final histogram, belief-map row, leaderboard
 *
 * The teacher dashboard always sees the blind price from snapshot on; the
 * projector additionally checks `blindRevealed` before showing it (that is
 * demo step 2, the Reveal button). Aggregates only: clusters are label +
 * count, no wealth, no per-student dynamics labels.
 *
 * Plan §17 fields are emitted with their defaults here; each feature fills
 * in its own values as it lands.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Phase, TeacherQuestionRow, TeacherView } from '@/lib/types'
import type { QuestionRow, SessionRow } from '@/lib/db/types'
import * as q from '@/lib/db/queries'
import { featuresOf } from '@/lib/features'
import { livePricePct } from '@/lib/phases/machine'
import { maybeAdvance, questionLiquidity, toStates } from '@/lib/phases/advance'
import { histogram10 } from '@/lib/scoring/histogram'
import { beliefMapReading } from '@/lib/scoring/reading'
import { MIN_REASONS_TO_CLUSTER } from '@/lib/agents/clusterer'
import { joinUrlFor, phaseAtLeast, round1, sessionLeaderboard } from './common'

function questionRow(qu: QuestionRow): TeacherQuestionRow {
  const blind = round1(qu.blind_price_pct)
  const post = round1(qu.post_price_pct)
  const outcome = qu.mode === 'stem' ? qu.correct_answer : null
  return {
    id: qu.id,
    index: qu.order_index,
    proposition: qu.proposition,
    mode: qu.mode,
    phase: qu.phase,
    correctAnswer: qu.correct_answer,
    blindPricePct: blind,
    postPricePct: post,
    movementPct: blind !== null && post !== null ? round1(post - blind) : null,
    reading: beliefMapReading(blind, post, outcome, qu.mode),
    cascade: qu.cascade_mode,
    spAnswer: qu.sp_answer,
    referenceAnswer: qu.reference_answer,
    clusterCount: null,
    sourceIndex: null,
  }
}

export async function buildTeacherView(client: SupabaseClient, session: SessionRow, now: Date): Promise<TeacherView> {
  const [participants, questionsRaw, tickVersion] = await Promise.all([
    q.listParticipants(client, session.id),
    q.listQuestions(client, session.id),
    q.getTickVersion(client, session.id),
  ])
  let questions = questionsRaw
  const features = featuresOf(session.features)

  const view: TeacherView = {
    session: {
      id: session.id,
      code: session.code,
      title: session.title,
      joinUrl: joinUrlFor(session),
      budget: session.budget,
      k: session.k,
      timers: {
        blindSeconds: session.blind_seconds,
        turnSeconds: session.turn_seconds,
        openSeconds: session.open_seconds,
      },
      status: session.status,
      features,
    },
    serverTime: now.toISOString(),
    participants: participants.map((p) => ({ id: p.id, name: p.display_name, joinedAt: p.joined_at })),
    questions: [],
    cascadeComparison: null,
    current: null,
    leaderboard: [],
    realtime: { tickVersion },
  }

  let current: QuestionRow | null = session.current_question_id
    ? (questions.find((qu) => qu.id === session.current_question_id) ?? null)
    : null

  if (current && current.phase !== 'pending') {
    current = await maybeAdvance(client, session, current, now)
    questions = questions.map((qu) => (qu.id === current!.id ? current! : qu))
  }

  view.questions = questions.map(questionRow)
  view.leaderboard = await sessionLeaderboard(client, participants, questions, features)

  if (!current || current.phase === 'pending') return view

  const phase = current.phase
  const [submissions, groups, clusters, trades] = await Promise.all([
    q.listSubmissions(client, current.id),
    phaseAtLeast(phase, 'snapshot') ? q.listGroups(client, current.id) : Promise.resolve([]),
    phaseAtLeast(phase, 'snapshot') ? q.listClusters(client, current.id) : Promise.resolve([]),
    phaseAtLeast(phase, 'open') ? q.listTrades(client, current.id) : Promise.resolve([]),
  ])
  const byParticipant = new Map(submissions.map((s) => [s.participant_id, s]))
  const nameOf = new Map(participants.map((p) => [p.id, p.display_name]))
  const b = questionLiquidity(current, session, participants.length)

  let pricePct: number | null = null
  if (phase === 'snapshot' || phase === 'structured') pricePct = round1(current.blind_price_pct)
  else if (phase === 'open') pricePct = round1(livePricePct(toStates(submissions), session.budget, b))
  else if (phase === 'resolved')
    pricePct = round1(current.post_price_pct ?? livePricePct(toStates(submissions), session.budget, b))

  const reasoningCount = submissions.filter((s) => (s.reasoning ?? '').trim().length > 0).length
  const clustersStatus =
    clusters.length > 0
      ? 'ready'
      : phaseAtLeast(phase, 'snapshot') && reasoningCount < MIN_REASONS_TO_CLUSTER
        ? 'skipped'
        : 'none'

  // Price history starts at the blind price. Its timestamp is the snapshot
  // moment when we are still in snapshot; afterwards phase_started_at has
  // moved on, so we use the first trade's time (or now) as an approximation.
  const priceHistory: { t: string; pct: number; phase: Phase }[] = []
  if (current.blind_price_pct !== null && phaseAtLeast(phase, 'snapshot')) {
    const t =
      phase === 'snapshot'
        ? (current.phase_started_at ?? now.toISOString())
        : (trades[0]?.created_at ?? current.phase_started_at ?? now.toISOString())
    priceHistory.push({ t, pct: round1(current.blind_price_pct) ?? 50, phase: 'snapshot' })
  }
  for (const tr of trades) priceHistory.push({ t: tr.created_at, pct: round1(tr.price_after_pct) ?? 50, phase: 'open' })

  view.current = {
    questionId: current.id,
    index: current.order_index,
    proposition: current.proposition,
    mode: current.mode,
    correctAnswer: current.correct_answer,
    phase,
    phaseStartedAt: current.phase_started_at,
    phaseEndsAt: current.phase_ends_at,
    cascade: current.cascade_mode,
    phaseLog: current.phase_log,
    referenceAnswer: current.reference_answer,
    submissionCount: submissions.filter((s) => s.blind_pct !== null).length,
    participantCount: participants.length,
    blindPricePct: round1(current.blind_price_pct),
    blindRevealed: current.blind_revealed,
    pricePct,
    histogramBlind: histogram10(submissions.map((s) => s.blind_pct)),
    histogramCurrent: histogram10(submissions.map((s) => s.current_pct ?? s.blind_pct)),
    clustersStatus,
    clusters: clusters.map((c) => ({ index: c.idx, label: c.label, count: c.member_ids.length })),
    groups: groups.map((g) => ({
      index: g.idx,
      members: g.turn_order.map((id) => ({
        name: nameOf.get(id) ?? 'Student',
        blindPct: byParticipant.get(id)?.blind_pct ?? null,
      })),
      turnOrder: g.turn_order.map((id) => nameOf.get(id) ?? 'Student'),
      socratesQuestions: null,
    })),
    priceHistory,
    narration: null,
    consideredOpposite: null,
    surprisinglyPopular: null,
    socraticStatus: 'none',
    steelman: null,
    topArguments: [],
    argumentVotersPct: null,
  }

  return view
}
