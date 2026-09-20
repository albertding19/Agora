/**
 * Student view model. This is the ONLY place the student surface's visibility
 * rules live (hackmit-plan.md §4 and ARCHITECTURE.md "Visibility"):
 *
 *   blind       proposition, own text, own band, own number. No price.
 *   snapshot    "reading the room"; blind price only if the teacher revealed it.
 *   structured  own group and speaking order; blind price only if revealed.
 *   open        live price, own number (revisable).
 *   resolved    outcome, own calibration before/after, persuasion, leaderboard top.
 *
 * Wealth, stake, quantities, and other students' numbers never appear here.
 *
 * Plan §17 fields are emitted with their defaults here; each feature fills
 * in its own values as it lands (consider-the-opposite step, prediction,
 * steelman, Socrates questions, argument pairs).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { StudentView } from '@/lib/types'
import type { ParticipantRow, QuestionRow, SessionRow } from '@/lib/db/types'
import * as q from '@/lib/db/queries'
import { featuresOf } from '@/lib/features'
import { livePricePct } from '@/lib/phases/machine'
import { maybeAdvance, questionLiquidity, toStates } from '@/lib/phases/advance'
import { phaseAtLeast, round1, sessionLeaderboard } from './common'

const LEADERBOARD_TOP = 5

export async function buildStudentView(
  client: SupabaseClient,
  session: SessionRow,
  participant: ParticipantRow,
  now: Date,
): Promise<StudentView> {
  const questions = await q.listQuestions(client, session.id)
  const features = featuresOf(session.features)
  const empty: StudentView = {
    session: { code: session.code, title: session.title },
    features,
    me: { participantId: participant.id, name: participant.display_name },
    serverTime: now.toISOString(),
    status: 'lobby',
    phase: null,
    phaseStartedAt: null,
    phaseEndsAt: null,
    question: null,
    my: null,
    group: null,
    pricePct: null,
    result: null,
  }

  if (session.status === 'ended') return { ...empty, status: 'ended' }
  if (!session.current_question_id) return empty

  let question: QuestionRow | null =
    questions.find((qu) => qu.id === session.current_question_id) ??
    (await q.getQuestion(client, session.current_question_id))
  if (!question || question.phase === 'pending') return empty

  question = await maybeAdvance(client, session, question, now)
  const phase = question.phase

  const [participants, submissions, groups] = await Promise.all([
    q.listParticipants(client, session.id),
    q.listSubmissions(client, question.id),
    phaseAtLeast(phase, 'snapshot') ? q.listGroups(client, question.id) : Promise.resolve([]),
  ])
  const nameOf = new Map(participants.map((p) => [p.id, p.display_name]))
  const mine = submissions.find((s) => s.participant_id === participant.id) ?? null
  const myGroup = groups.find((g) => g.turn_order.includes(participant.id)) ?? null

  // In blind everyone present can take part. Later, only students who were
  // grouped at snapshot (submitters or not) are in the question.
  const inQuestion = phase === 'blind' || mine !== null || myGroup !== null

  const view: StudentView = {
    ...empty,
    status: inQuestion ? 'in-question' : 'waiting-next-question',
    phase,
    phaseStartedAt: question.phase_started_at,
    phaseEndsAt: question.phase_ends_at,
    question: {
      id: question.id,
      proposition: question.proposition,
      mode: question.mode,
      index: question.order_index,
      count: questions.length,
    },
  }
  if (!inQuestion) return view

  view.my = {
    reasoning: mine?.reasoning ?? null,
    band:
      mine?.ai_stance && mine.ai_band_lo !== null && mine.ai_band_hi !== null
        ? { stance: mine.ai_stance, lo: mine.ai_band_lo, hi: mine.ai_band_hi, reading: mine.ai_reading ?? '' }
        : null,
    pct: mine ? (mine.current_pct ?? mine.blind_pct) : null,
    submitted: mine?.blind_pct !== null && mine?.blind_pct !== undefined,
    firstPct: null,
    oppositePct: null,
    oppositeReasoning: null,
    blindStep: 'first',
    predictedTruePct: null,
    steelmanSide: null,
    steelman: null,
  }

  if (phaseAtLeast(phase, 'structured') && myGroup) {
    const names = myGroup.turn_order.map((id) => nameOf.get(id) ?? 'Student')
    view.group = {
      members: names.map((name) => ({ name })),
      turnOrder: names,
      turnSeconds: session.turn_seconds,
      socratesQuestions: null,
    }
  }

  const b = questionLiquidity(question, session, participants.length)
  if (phase === 'open') {
    view.pricePct = round1(livePricePct(toStates(submissions), session.budget, b))
  } else if (phase === 'resolved') {
    view.pricePct = round1(question.post_price_pct ?? livePricePct(toStates(submissions), session.budget, b))
  } else if ((phase === 'snapshot' || phase === 'structured') && question.blind_revealed) {
    view.pricePct = round1(question.blind_price_pct)
  }

  if (phase === 'resolved') {
    const leaderboard = await sessionLeaderboard(
      client,
      participants,
      questions.map((qu) => (qu.id === question.id ? question : qu)),
      features,
    )
    view.result = {
      outcome: question.mode === 'stem' ? question.correct_answer : null,
      calibrationFinal: round1(mine?.calibration_final ?? null),
      calibrationBlind: round1(mine?.calibration_blind ?? null),
      persuasion: round1(mine?.persuasion ?? null),
      leaderboardTop: leaderboard.slice(0, LEADERBOARD_TOP),
      surprisinglyPopular: null,
      steelman: null,
      contrarianBonus: null,
      argumentPairs: [],
      argumentVotesCast: 0,
    }
  }

  return view
}
