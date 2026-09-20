/**
 * Row builders for the view tests. Every id is a valid RFC 4122 uuid so the
 * built views pass the `z.uuid()` checks in lib/types.ts. Overrides win.
 */
import type {
  ArgumentVoteRow,
  GroupRow,
  ParticipantRow,
  QuestionRow,
  SessionRow,
  SubmissionRow,
} from '@/lib/db/types'

export const SESSION_ID = '00000000-0000-4000-8000-000000000001'
export const QUESTION_ID = '00000000-0000-4000-8000-000000000002'
export const P1 = '00000000-0000-4000-8000-000000000011'
export const P2 = '00000000-0000-4000-8000-000000000012'
export const P3 = '00000000-0000-4000-8000-000000000013'
export const P4 = '00000000-0000-4000-8000-000000000014'
export const P5 = '00000000-0000-4000-8000-000000000015'
export const P6 = '00000000-0000-4000-8000-000000000016'
export const T0 = '2026-09-20T10:00:00.000Z'
export const NOW = new Date('2026-09-20T10:00:30.000Z')

export function sessionRow(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: SESSION_ID,
    code: 'ABCD',
    title: 'Test session',
    teacher_token: 'secret',
    budget: 100,
    k: 0.4,
    blind_seconds: 75,
    turn_seconds: 30,
    open_seconds: 60,
    current_question_id: QUESTION_ID,
    status: 'active',
    classroom_id: null,
    features: {},
    created_at: T0,
    ...over,
  }
}

export function questionRow(over: Partial<QuestionRow> = {}): QuestionRow {
  return {
    id: QUESTION_ID,
    session_id: SESSION_ID,
    order_index: 0,
    proposition: 'The ball costs 10 cents.',
    mode: 'stem',
    correct_answer: false,
    phase: 'snapshot',
    phase_started_at: T0,
    phase_ends_at: null,
    liquidity_b: null,
    n_at_start: 3,
    blind_price_pct: 80,
    post_price_pct: null,
    blind_revealed: false,
    reference_answer: null,
    source_question_id: null,
    cascade_mode: false,
    phase_log: [
      { phase: 'blind', at: T0 },
      { phase: 'snapshot', at: T0 },
    ],
    sp_actual_true_pct: null,
    sp_predicted_true_pct: null,
    sp_answer: null,
    created_at: T0,
    ...over,
  }
}

export function participantRow(id: string, name: string): ParticipantRow {
  return { id, session_id: SESSION_ID, display_name: name, joined_at: T0 }
}

let submissionSeq = 0

export function submissionRow(over: Partial<SubmissionRow> & { participant_id: string }): SubmissionRow {
  submissionSeq += 1
  const row: SubmissionRow = {
    id: `00000000-0000-4000-8000-0000000001${String(submissionSeq).padStart(2, '0')}`,
    question_id: QUESTION_ID,
    reasoning: null,
    ai_stance: null,
    ai_band_lo: null,
    ai_band_hi: null,
    ai_reading: null,
    blind_pct: 70,
    blind_submitted_at: T0,
    current_pct: 70,
    final_pct: null,
    group_id: null,
    cluster_index: null,
    calibration_final: null,
    calibration_blind: null,
    persuasion: null,
    first_pct: 70,
    opposite_pct: null,
    opposite_reasoning: null,
    predicted_true_pct: null,
    sp_insight: null,
    steelman_text: null,
    steelman_score: null,
    steelman_note: null,
    contrarian_bonus: null,
    created_at: T0,
    updated_at: T0,
    ...over,
  }
  // With no second number the first number is the blind number (plan §17.1),
  // so a test that sets only `blind_pct` keeps the invariant; an explicit
  // `first_pct` (a blend, or null for a pre-0002 row) wins.
  if (over.first_pct === undefined) row.first_pct = row.blind_pct
  return row
}

export function groupRow(over: Partial<GroupRow> = {}): GroupRow {
  return {
    id: '00000000-0000-4000-8000-000000000201',
    question_id: QUESTION_ID,
    idx: 0,
    turn_order: [P1, P2, P3],
    socratic_questions: null,
    ...over,
  }
}

export function voteRow(voterId: string, winner: string, loser: string): ArgumentVoteRow {
  return {
    id: `00000000-0000-4000-8000-0000000003${String((submissionSeq += 1)).padStart(2, '0')}`,
    question_id: QUESTION_ID,
    voter_id: voterId,
    winner_submission_id: winner,
    loser_submission_id: loser,
    created_at: T0,
  }
}
