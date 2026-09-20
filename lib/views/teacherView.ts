/**
 * Teacher / projector view model. The projector page renders this with the
 * controls hidden, so the price rules below are what the big screen obeys:
 *
 *   blind       submission count only (no price anywhere) — except a cascade
 *               question (§17.5), whose live blind price is the point
 *   snapshot    blind price, histogram, groups, clusters when ready,
 *               SP answer (§17.2), steelman + Socrates aggregates (§17.4, §17.7)
 *   structured  same, plus turn timers
 *   open        live price and price history (§17.6 arc points)
 *   resolved    final histogram, belief-map row, leaderboard, SP insight rate,
 *               top arguments by pairwise strength (§17.9b)
 *   open mode   (§17.3, a question *mode*) no price in any phase; the
 *               submission count is the answer count; reading = cluster count
 *
 * The teacher dashboard always sees the blind price from snapshot on; the
 * projector additionally checks `blindRevealed` before showing it (that is
 * demo step 2, the Reveal button). Aggregates only: clusters are label +
 * count, percentages never "N of M" outside the participation stats, no
 * wealth, no per-student dynamics labels, no student's steelman text.
 * `topArguments` are anonymous texts ranked by Bradley-Terry strength; the
 * per-argument comparison count is a teacher-only number and never reaches
 * a phone. Every flag-gated field is null/empty when its flag is off.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SocraticStatus, TeacherQuestionRow, TeacherView } from '@/lib/types'
import type { QuestionRow, SessionRow } from '@/lib/db/types'
import * as q from '@/lib/db/queries'
import { featuresOf } from '@/lib/features'
import { blindPricePct, isOpenQuestion, livePricePct } from '@/lib/phases/machine'
import { maybeAdvance, questionLiquidity, toStates } from '@/lib/phases/advance'
import { histogram10 } from '@/lib/scoring/histogram'
import { beliefMapReading, openQuestionReading } from '@/lib/scoring/reading'
import { cascadeReading, findCascadePair } from '@/lib/scoring/cascade'
import { priceHistoryPoints } from '@/lib/scoring/priceHistory'
import { lean } from '@/lib/scoring/surprisinglyPopular'
import { bradleyTerry, winPct } from '@/lib/scoring/bradleyTerry'
import { MIN_REASONS_TO_CLUSTER } from '@/lib/agents/clusterer'
import { joinUrlFor, mean, pctOf, phaseAtLeast, round1, sessionLeaderboard } from './common'

const TOP_ARGUMENTS = 3

type TopArgument = NonNullable<TeacherView['current']>['topArguments'][number]

interface RowExtras {
  /** §17.3: number of answer clusters of an open question, once clustered; null otherwise. */
  clusterCount: number | null
  /** §17.3: order index of the open question this one was sharpened from. */
  sourceIndex: number | null
}

function questionRow(qu: QuestionRow, extras: RowExtras): TeacherQuestionRow {
  const blind = round1(qu.blind_price_pct)
  const post = round1(qu.post_price_pct)
  const outcome = qu.mode === 'stem' ? qu.correct_answer : null
  // §17.3: an open question has no price, so its reading is about its clusters
  // (null while pending, like every other row's reading).
  const reading = isOpenQuestion(qu)
    ? qu.phase === 'pending'
      ? null
      : openQuestionReading(extras.clusterCount)
    : beliefMapReading(blind, post, outcome, qu.mode)
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
    reading,
    cascade: qu.cascade_mode,
    spAnswer: qu.sp_answer,
    referenceAnswer: qu.reference_answer,
    clusterCount: extras.clusterCount,
    sourceIndex: extras.sourceIndex,
  }
}

function hasText(s: string | null | undefined): boolean {
  return (s ?? '').trim().length > 0
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

  // §17.3: one batched cluster query over every open question that can have
  // clusters (snapshot or later) — never a query per row. With no open
  // questions the helper returns [] without touching the database.
  const openIds = questions.filter((qu) => isOpenQuestion(qu) && phaseAtLeast(qu.phase, 'snapshot')).map((qu) => qu.id)
  const [leaderboard, openClusters] = await Promise.all([
    sessionLeaderboard(client, participants, questions, features),
    q.listClustersForQuestions(client, openIds),
  ])
  const clusterCountById = new Map<string, number>()
  for (const c of openClusters) clusterCountById.set(c.question_id, (clusterCountById.get(c.question_id) ?? 0) + 1)
  const indexById = new Map(questions.map((qu) => [qu.id, qu.order_index]))

  view.questions = questions.map((qu) =>
    questionRow(qu, {
      clusterCount: isOpenQuestion(qu) ? (clusterCountById.get(qu.id) ?? null) : null,
      sourceIndex: qu.source_question_id !== null ? (indexById.get(qu.source_question_id) ?? null) : null,
    }),
  )
  view.leaderboard = leaderboard

  // §17.5 cascade demo: the same proposition run blind and with the consensus
  // visible, compared at snapshot (both runs have a blind price). Computed
  // over the whole list so it stays on the dashboard between questions.
  const pair = findCascadePair(questions)
  const pairBlindPct = pair ? round1(pair.blind.blind_price_pct) : null
  if (pair && pairBlindPct !== null) {
    const cascadePct = round1(pair.cascade.blind_price_pct)
    view.cascadeComparison = {
      proposition: pair.blind.proposition,
      blindQuestionId: pair.blind.id,
      cascadeQuestionId: pair.cascade.id,
      blindPricePct: pairBlindPct,
      cascadePricePct: cascadePct,
      gapPct: cascadePct !== null ? round1(cascadePct - pairBlindPct) : null,
      blindRevealed: pair.blind.blind_revealed,
      reading: cascadePct !== null ? cascadeReading(pairBlindPct, cascadePct) : null,
    }
  }

  if (!current || current.phase === 'pending') return view

  const phase = current.phase
  const open = isOpenQuestion(current)
  const [submissions, groups, clusters, trades] = await Promise.all([
    q.listSubmissions(client, current.id),
    phaseAtLeast(phase, 'snapshot') ? q.listGroups(client, current.id) : Promise.resolve([]),
    // The batched query above already holds an open question's clusters.
    phaseAtLeast(phase, 'snapshot')
      ? open
        ? Promise.resolve(openClusters.filter((c) => c.question_id === current.id))
        : q.listClusters(client, current.id)
      : Promise.resolve([]),
    // §17.5: a cascade question logs blind-phase trades, so load them from blind on.
    current.cascade_mode || phaseAtLeast(phase, 'open') ? q.listTrades(client, current.id) : Promise.resolve([]),
  ])
  const byParticipant = new Map(submissions.map((s) => [s.participant_id, s]))
  const nameOf = new Map(participants.map((p) => [p.id, p.display_name]))
  const b = questionLiquidity(current, session, participants.length)

  // Price rules (see the header). An open question never has one.
  let pricePct: number | null = null
  if (open) pricePct = null
  else if (phase === 'blind' && current.cascade_mode)
    pricePct = round1(blindPricePct(toStates(submissions), session.budget, b))
  else if (phase === 'snapshot' || phase === 'structured') pricePct = round1(current.blind_price_pct)
  else if (phase === 'open') pricePct = round1(livePricePct(toStates(submissions), session.budget, b))
  else if (phase === 'resolved')
    pricePct = round1(current.post_price_pct ?? livePricePct(toStates(submissions), session.budget, b))

  const submitters = submissions.filter((s) => s.blind_pct !== null)
  const reasoningCount = submissions.filter((s) => hasText(s.reasoning)).length
  const clustersStatus =
    clusters.length > 0
      ? 'ready'
      : phaseAtLeast(phase, 'snapshot') && reasoningCount < MIN_REASONS_TO_CLUSTER
        ? 'skipped'
        : 'none'

  // §17.6 the Socratic arc: anonymous price points with phase labels. The
  // polled view drops the per-point note; GET /api/questions/:id/history
  // carries it for the replay.
  const priceHistory = priceHistoryPoints({
    phase,
    cascade: current.cascade_mode,
    phaseLog: current.phase_log,
    phaseStartedAt: current.phase_started_at,
    blindPricePct: current.blind_price_pct,
    postPricePct: current.post_price_pct,
    trades: trades.map((t) => ({ phase: t.phase, created_at: t.created_at, price_after_pct: t.price_after_pct })),
    now: now.toISOString(),
  }).map((pt) => ({ t: pt.t, pct: pt.pct, phase: pt.phase }))

  // §17.1 consider the opposite: percent of blind submitters with a second
  // number, and how far the blend pulled the first number on average.
  let consideredOpposite: NonNullable<TeacherView['current']>['consideredOpposite'] = null
  if (features.considerOpposite) {
    const shifts: number[] = []
    let withOpposite = 0
    for (const s of submitters) {
      if (s.opposite_pct === null || s.blind_pct === null) continue
      withOpposite += 1
      shifts.push(Math.abs((s.first_pct ?? s.blind_pct) - s.blind_pct))
    }
    consideredOpposite = {
      pct: pctOf(withOpposite, submitters.length) ?? 0,
      meanShiftPts: round1(mean(shifts)),
    }
  }

  // §17.2 surprisingly popular: the class numbers are frozen at snapshot (null
  // during blind, like the blind price); the predictor rate is live; the
  // insight rate exists only once resolved. Percentages, never counts.
  let surprisinglyPopular: NonNullable<TeacherView['current']>['surprisinglyPopular'] = null
  if (features.predictClass) {
    const frozen = phaseAtLeast(phase, 'snapshot')
    const predictors = submitters.filter((s) => s.predicted_true_pct !== null).length
    const insightRows = submissions.filter((s) => s.sp_insight !== null)
    const insightTrue = insightRows.filter((s) => s.sp_insight === true).length
    surprisinglyPopular = {
      actualTruePct: frozen ? round1(current.sp_actual_true_pct) : null,
      predictedTruePct: frozen ? round1(current.sp_predicted_true_pct) : null,
      answer: frozen ? current.sp_answer : null,
      predictorPct: pctOf(predictors, submitters.length),
      insightPct: phase === 'resolved' ? pctOf(insightTrue, insightRows.length) : null,
    }
  }

  // §17.4 Socrates: ready once any group has its questions; skipped when the
  // question can have none (no groups, or an open question) from snapshot on.
  const socraticStatus: SocraticStatus = groups.some((g) => (g.socratic_questions?.length ?? 0) > 0)
    ? 'ready'
    : phaseAtLeast(phase, 'snapshot') && (groups.length === 0 || open)
      ? 'skipped'
      : 'none'

  // §17.7 steelman gate: how many wrote one and the mean fidelity. No text.
  let steelman: NonNullable<TeacherView['current']>['steelman'] = null
  if (features.steelman && !open && phaseAtLeast(phase, 'snapshot')) {
    const scores = submissions.map((s) => s.steelman_score).filter((v): v is number => v !== null)
    steelman = {
      count: submissions.filter((s) => hasText(s.steelman_text)).length,
      total: participants.length,
      meanFidelity: round1(mean(scores)),
    }
  }

  // §17.9b argument Elo: Bradley-Terry over the phones' pairwise comparisons,
  // top three by strength. `side` is the argument's own blind lean (an
  // aggregate-safe hint); `comparisons` is teacher-only. The voter rate is a
  // percentage of participants, never a count.
  let topArguments: TopArgument[] = []
  let argumentVotersPct: number | null = null
  if (features.argumentElo && !open && phase === 'resolved') {
    const votes = await q.listArgumentVotes(client, current.id)
    if (votes.length > 0) {
      const withText = submissions.filter((s) => hasText(s.reasoning))
      const strengths = bradleyTerry(
        withText.map((s) => s.id),
        votes.map((v) => ({ winner: v.winner_submission_id, loser: v.loser_submission_id })),
      )
      const comparisons = new Map<string, number>()
      for (const v of votes) {
        comparisons.set(v.winner_submission_id, (comparisons.get(v.winner_submission_id) ?? 0) + 1)
        comparisons.set(v.loser_submission_id, (comparisons.get(v.loser_submission_id) ?? 0) + 1)
      }
      topArguments = withText
        .filter((s) => (comparisons.get(s.id) ?? 0) > 0)
        .map((s) => ({ s, strength: strengths.get(s.id) ?? 1 }))
        .sort((x, y) => y.strength - x.strength)
        .slice(0, TOP_ARGUMENTS)
        .map(({ s, strength }) => {
          const side = lean(s.blind_pct)
          return {
            text: (s.reasoning ?? '').trim(),
            strength: round1(strength),
            winPct: winPct(strength),
            side: side === true ? 'TRUE' : side === false ? 'FALSE' : null,
            comparisons: comparisons.get(s.id) ?? 0,
          }
        })
      argumentVotersPct = pctOf(new Set(votes.map((v) => v.voter_id)).size, participants.length)
    }
  }

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
    // §17.3: an open question's submissions are its answers.
    submissionCount: open ? reasoningCount : submitters.length,
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
      // §17.4: one question per speaker, in turn order.
      socratesQuestions: g.socratic_questions ?? null,
    })),
    priceHistory,
    narration: null,
    consideredOpposite,
    surprisinglyPopular,
    socraticStatus,
    steelman,
    topArguments,
    argumentVotersPct,
  }

  return view
}
