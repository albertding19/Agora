/**
 * Student view model. This is the ONLY place the student surface's visibility
 * rules live (hackmit-plan.md §4, §17 and ARCHITECTURE.md "Visibility"):
 *
 *   blind       proposition, own text, own band, own number(s), own prediction.
 *               No price — except a cascade question (§17.5), where the live
 *               blind price is the point.
 *   snapshot    "reading the room"; blind price only if the teacher revealed it.
 *               Steelman gate open (§17.7, flag): own side, own text + grade.
 *   structured  own group and speaking order; blind price only if revealed.
 *               Own group's Socrates questions (§17.4). Steelman still open.
 *   open        live price, own number (revisable).
 *   resolved    outcome, own calibration before/after, persuasion, leaderboard
 *               top; with flags: own SP insight (§17.2), own steelman fidelity
 *               (§17.7), own contrarian credit (§17.9a), anonymous argument
 *               pairs to compare (§17.9b).
 *   open mode   (§17.3, a question *mode*) no number and no price in any
 *               phase; `submitted` means "wrote an answer".
 *
 * Wealth, stake, quantities, and other students' numbers or names never
 * appear here. Argument pairs carry opaque submission ids and texts only.
 * Every §17 field is null/empty when its flag is off, so the P0 view is
 * unchanged.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BlindStep, StudentView } from '@/lib/types'
import type { ParticipantRow, QuestionRow, SessionRow } from '@/lib/db/types'
import * as q from '@/lib/db/queries'
import { featuresOf } from '@/lib/features'
import { blindPricePct, isOpenQuestion, livePricePct } from '@/lib/phases/machine'
import { maybeAdvance, questionLiquidity, toStates } from '@/lib/phases/advance'
import { steelmanSideFor } from '@/lib/scoring/steelman'
import { selectArgumentPairs } from '@/lib/scoring/argumentPairs'
import type { ArgumentCandidate } from '@/lib/scoring/argumentPairs'
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
  const open = isOpenQuestion(question)

  const [participants, submissions, groups] = await Promise.all([
    q.listParticipants(client, session.id),
    q.listSubmissions(client, question.id),
    phaseAtLeast(phase, 'snapshot') ? q.listGroups(client, question.id) : Promise.resolve([]),
  ])
  const nameOf = new Map(participants.map((p) => [p.id, p.display_name]))
  const mine = submissions.find((s) => s.participant_id === participant.id) ?? null
  const myGroup = groups.find((g) => g.turn_order.includes(participant.id)) ?? null

  // In blind everyone present can take part. Later, only students who were
  // grouped at snapshot (submitters or not) are in the question. An open
  // question (§17.3) has no groups, so everyone stays in it to the end.
  const inQuestion = phase === 'blind' || mine !== null || myGroup !== null || open

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

  // §17.1 consider the opposite: the first number is `first_pct`; rows
  // written before the feature existed carry it in `blind_pct`. `pct` stays
  // the blended number the engine reads. The blind step is decided here so a
  // refresh restores the phone's screen.
  const first = mine?.first_pct ?? mine?.blind_pct ?? null
  const blindStep: BlindStep =
    first === null ? 'first' : features.considerOpposite && mine?.opposite_pct == null ? 'opposite' : 'done'

  view.my = {
    reasoning: mine?.reasoning ?? null,
    band:
      mine?.ai_stance && mine.ai_band_lo !== null && mine.ai_band_hi !== null
        ? { stance: mine.ai_stance, lo: mine.ai_band_lo, hi: mine.ai_band_hi, reading: mine.ai_reading ?? '' }
        : null,
    pct: mine ? (mine.current_pct ?? mine.blind_pct) : null,
    // §17.3: an open question is "submitted" once an answer is written.
    submitted: open
      ? (mine?.reasoning ?? '').trim().length > 0
      : mine?.blind_pct !== null && mine?.blind_pct !== undefined,
    firstPct: first,
    // Gated on the flag: a second number recorded before the flag was
    // switched off must not resurface, or the phone would print an "average"
    // that is not the number on record.
    oppositePct: features.considerOpposite ? (mine?.opposite_pct ?? null) : null,
    oppositeReasoning: features.considerOpposite ? (mine?.opposite_reasoning ?? null) : null,
    blindStep,
    // §17.2 predict the class: stored whenever sent; the UI gates on the flag.
    predictedTruePct: mine?.predicted_true_pct ?? null,
    steelmanSide: null,
    steelman: null,
  }

  // §17.7 steelman gate: open from snapshot on, never for an open question.
  // The side is derived from the student's own blind number; the grade is
  // their own. Nothing here about any other student.
  if (features.steelman && !open && phaseAtLeast(phase, 'snapshot')) {
    view.my.steelmanSide = steelmanSideFor(mine?.blind_pct ?? null)
    view.my.steelman = mine?.steelman_text
      ? { text: mine.steelman_text, score: round1(mine.steelman_score), note: mine.steelman_note }
      : null
  }

  if (phaseAtLeast(phase, 'structured') && myGroup) {
    const names = myGroup.turn_order.map((id) => nameOf.get(id) ?? 'Student')
    view.group = {
      members: names.map((name) => ({ name })),
      turnOrder: names,
      turnSeconds: session.turn_seconds,
      // §17.4 Socrates: the student's own group's questions only, one per
      // speaker; null with the flag off (the route is not flag-gated, so the
      // view is — the component check is defense in depth).
      socratesQuestions: features.socrates ? (myGroup.socratic_questions ?? null) : null,
    }
  }

  // Price gate. An open question (§17.3) has no price in any phase — not even
  // the resolved fallback, which would otherwise price an empty class at 50.
  if (!open) {
    const b = questionLiquidity(question, session, participants.length)
    if (phase === 'blind' && question.cascade_mode) {
      // §17.5 cascade: the live consensus over blind numbers, 50 before anyone submits.
      view.pricePct = round1(blindPricePct(toStates(submissions), session.budget, b))
    } else if (phase === 'open') {
      view.pricePct = round1(livePricePct(toStates(submissions), session.budget, b))
    } else if (phase === 'resolved') {
      view.pricePct = round1(question.post_price_pct ?? livePricePct(toStates(submissions), session.budget, b))
    } else if ((phase === 'snapshot' || phase === 'structured') && question.blind_revealed) {
      view.pricePct = round1(question.blind_price_pct)
    }
  }

  if (phase === 'resolved') {
    // §17.9b argument Elo: the one extra query, only with the flag on and only
    // for a proposition (an open question's answers are not arguments).
    const duel = features.argumentElo && !open
    const [leaderboard, votes] = await Promise.all([
      sessionLeaderboard(
        client,
        participants,
        questions.map((qu) => (qu.id === question.id ? question : qu)),
        features,
      ),
      duel ? q.listArgumentVotes(client, question.id) : Promise.resolve([]),
    ])
    view.result = {
      outcome: question.mode === 'stem' ? question.correct_answer : null,
      calibrationFinal: round1(mine?.calibration_final ?? null),
      calibrationBlind: round1(mine?.calibration_blind ?? null),
      persuasion: round1(mine?.persuasion ?? null),
      leaderboardTop: leaderboard.slice(0, LEADERBOARD_TOP),
      // §17.2 surprisingly popular: class aggregates plus the student's own insight flag.
      surprisinglyPopular: features.predictClass
        ? {
            answer: question.sp_answer,
            actualTruePct: round1(question.sp_actual_true_pct),
            predictedTruePct: round1(question.sp_predicted_true_pct),
            insight: mine?.sp_insight ?? null,
          }
        : null,
      // §17.7: own fidelity. §17.9a: own contrarian credit.
      steelman: features.steelman ? round1(mine?.steelman_score ?? null) : null,
      contrarianBonus: features.contrarianCredit ? (mine?.contrarian_bonus ?? null) : null,
      argumentPairs: [],
      argumentVotesCast: 0,
    }

    if (duel) {
      // Pairs are seeded per (question, voter) so the 2 s poll never reshuffles
      // a pair under a thumb. Own argument excluded; opaque ids and texts only.
      const mineVotes = votes.filter((v) => v.voter_id === participant.id)
      const candidates: ArgumentCandidate[] = submissions
        .filter((s) => (s.reasoning ?? '').trim().length > 0)
        .map((s) => ({
          submissionId: s.id,
          participantId: s.participant_id,
          text: (s.reasoning ?? '').trim(),
          blindPct: s.blind_pct,
        }))
      view.result.argumentPairs = selectArgumentPairs({
        questionId: question.id,
        voterId: participant.id,
        candidates,
        alreadyCompared: mineVotes.map((v) => ({ a: v.winner_submission_id, b: v.loser_submission_id })),
      })
      view.result.argumentVotesCast = mineVotes.length
    }
  }

  return view
}
