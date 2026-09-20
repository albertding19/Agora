/**
 * Database-aware phase transitions. The math is in machine.ts; this file
 * loads rows, calls the pure functions, writes results, and flips the phase
 * LAST with a `where phase = <from>` guard so concurrent callers are safe and
 * a crash mid-transition is simply retried by the next poll.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { HttpError, plusSeconds } from '@/lib/http'
import { liquidity } from '@/lib/market/lmsr'
import type { QuestionRow, SessionRow, SubmissionRow } from '@/lib/db/types'
import type { Timers } from '@/lib/types'
import * as q from '@/lib/db/queries'
import {
  autoAdvanceTarget,
  computeResolution,
  computeSnapshot,
  largestGroupSize,
  nextPhase,
  type SubmissionState,
} from './machine'

export function timersOf(session: SessionRow): Timers {
  return {
    blindSeconds: session.blind_seconds,
    turnSeconds: session.turn_seconds,
    openSeconds: session.open_seconds,
  }
}

export function toStates(rows: readonly SubmissionRow[]): SubmissionState[] {
  return rows.map((s) => ({ participantId: s.participant_id, blindPct: s.blind_pct, currentPct: s.current_pct }))
}

/** Liquidity for a question; falls back to the class-size rule if the row predates start. */
export function questionLiquidity(question: QuestionRow, session: SessionRow, participantCount: number): number {
  return question.liquidity_b ?? liquidity(question.n_at_start ?? participantCount, session.budget, session.k)
}

// ---------------------------------------------------------------------------

export async function startQuestion(
  client: SupabaseClient,
  session: SessionRow,
  questionId: string,
  now: Date,
): Promise<QuestionRow> {
  const question = await q.getQuestion(client, questionId)
  if (!question || question.session_id !== session.id) {
    throw new HttpError(404, 'question_not_found', 'No such question in this session')
  }
  if (question.phase !== 'pending') {
    throw new HttpError(409, 'question_not_pending', `Question is already ${question.phase}`)
  }
  if (session.current_question_id && session.current_question_id !== question.id) {
    const current = await q.getQuestion(client, session.current_question_id)
    if (current && current.phase !== 'resolved') {
      throw new HttpError(409, 'question_in_progress', 'Resolve the current question first')
    }
  }

  const participants = await q.listParticipants(client, session.id)
  const n = participants.length
  const updated = await q.updateQuestion(
    client,
    question.id,
    {
      phase: 'blind',
      phase_started_at: now.toISOString(),
      phase_ends_at: plusSeconds(now, session.blind_seconds),
      n_at_start: n,
      liquidity_b: liquidity(n, session.budget, session.k),
    },
    { phase: 'pending' },
  )
  if (!updated) throw new HttpError(409, 'question_not_pending', 'Question was started by someone else')

  await q.updateSession(client, session.id, { current_question_id: question.id, status: 'active' })
  await q.bumpTick(client, session.id)
  return updated
}

export interface AdvanceOptions {
  correctAnswer?: boolean
}

export async function advance(
  client: SupabaseClient,
  session: SessionRow,
  question: QuestionRow,
  from: QuestionRow['phase'],
  now: Date,
  opts: AdvanceOptions = {},
): Promise<QuestionRow> {
  if (question.phase !== from) {
    throw new HttpError(409, 'phase_mismatch', `Question is in ${question.phase}, not ${from}`)
  }
  const to = nextPhase(from)
  if (!to) throw new HttpError(409, 'already_resolved', 'Question is already resolved')

  const fields: Parameters<typeof q.updateQuestion>[2] = { phase: to, phase_started_at: now.toISOString() }

  if (from === 'pending') {
    throw new HttpError(409, 'use_start', 'Use the start route to begin a question')
  }

  if (from === 'blind') {
    const participants = await q.listParticipants(client, session.id)
    const submissions = await q.listSubmissions(client, question.id)
    const b = questionLiquidity(question, session, participants.length)
    const snapshot = computeSnapshot({
      participantIds: participants.map((p) => p.id),
      submissions: toStates(submissions),
      budget: session.budget,
      b,
    })
    await q.upsertGroups(client, question.id, snapshot.groups)
    fields.blind_price_pct = snapshot.blindPricePct
    fields.phase_ends_at = null
  }

  if (from === 'snapshot') {
    const groups = await q.listGroups(client, question.id)
    const largest = largestGroupSize(groups.map((g) => ({ turnOrder: g.turn_order })))
    fields.phase_ends_at = plusSeconds(now, session.turn_seconds * largest)
  }

  if (from === 'structured') {
    fields.phase_ends_at = plusSeconds(now, session.open_seconds)
  }

  if (from === 'open') {
    const answer = question.correct_answer ?? opts.correctAnswer ?? null
    if (question.mode === 'stem' && answer === null) {
      throw new HttpError(409, 'answer_required', 'Enter the correct answer to resolve a STEM question')
    }
    if (question.correct_answer === null && answer !== null) fields.correct_answer = answer

    const participants = await q.listParticipants(client, session.id)
    const submissions = await q.listSubmissions(client, question.id)
    const groups = await q.listGroups(client, question.id)
    const b = questionLiquidity(question, session, participants.length)
    const resolution = computeResolution({
      mode: question.mode,
      outcome: question.mode === 'stem' ? answer : null,
      budget: session.budget,
      b,
      submissions: toStates(submissions),
      groups: groups.map((g) => ({ idx: g.idx, turnOrder: g.turn_order })),
    })
    await q.upsertSubmissionPatches(
      client,
      question.id,
      [...resolution.perParticipant].map(([participantId, r]) => ({
        participantId,
        patch: {
          final_pct: r.finalPct,
          calibration_final: r.calibrationFinal,
          calibration_blind: r.calibrationBlind,
          persuasion: r.persuasion,
        },
      })),
    )
    fields.post_price_pct = resolution.postPricePct
    fields.phase_ends_at = null
  }

  const updated = await q.updateQuestion(client, question.id, fields, { phase: from })
  if (!updated) {
    // Someone else flipped it first; their work is identical to ours.
    const fresh = await q.getQuestion(client, question.id)
    if (!fresh) throw new HttpError(404, 'question_not_found', 'Question vanished mid-transition')
    return fresh
  }
  await q.bumpTick(client, session.id)
  return updated
}

/**
 * Lazy, server-side timer: called by both view builders on every read.
 * Advances a timed phase whose deadline (plus grace) has passed; a STEM
 * question without an answer stays open.
 */
export async function maybeAdvance(
  client: SupabaseClient,
  session: SessionRow,
  question: QuestionRow,
  now: Date,
): Promise<QuestionRow> {
  const target = autoAdvanceTarget(
    {
      phase: question.phase,
      mode: question.mode,
      correctAnswer: question.correct_answer,
      phaseEndsAt: question.phase_ends_at,
    },
    now,
  )
  if (!target) return question
  try {
    return await advance(client, session, question, question.phase, now)
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) {
      return (await q.getQuestion(client, question.id)) ?? question
    }
    throw err
  }
}

/** Teacher recovery button: only while in snapshot. Deterministic, so safe to repeat. */
export async function recomputeSnapshot(
  client: SupabaseClient,
  session: SessionRow,
  question: QuestionRow,
): Promise<QuestionRow> {
  if (question.phase !== 'snapshot') {
    throw new HttpError(409, 'not_in_snapshot', 'Snapshot can only be recomputed during the snapshot phase')
  }
  const participants = await q.listParticipants(client, session.id)
  const submissions = await q.listSubmissions(client, question.id)
  const b = questionLiquidity(question, session, participants.length)
  const snapshot = computeSnapshot({
    participantIds: participants.map((p) => p.id),
    submissions: toStates(submissions),
    budget: session.budget,
    b,
  })
  await q.upsertGroups(client, question.id, snapshot.groups)
  const updated = await q.updateQuestion(client, question.id, { blind_price_pct: snapshot.blindPricePct })
  await q.bumpTick(client, session.id)
  return updated ?? question
}

/** Show the blind price to the class (projector and phones). */
export async function reveal(client: SupabaseClient, session: SessionRow, question: QuestionRow): Promise<QuestionRow> {
  if (question.phase === 'pending' || question.phase === 'blind') {
    throw new HttpError(409, 'nothing_to_reveal', 'The blind price exists only after the blind phase')
  }
  const updated = await q.updateQuestion(client, question.id, { blind_revealed: true })
  await q.bumpTick(client, session.id)
  return updated ?? question
}
