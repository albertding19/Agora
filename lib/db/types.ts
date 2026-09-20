/**
 * Row types mirroring supabase/migrations/0001_init.sql and
 * 0002_extensions.sql. Hand-written on purpose (no codegen step in a 24-hour
 * build). Keep in sync with the SQL.
 */
import type { Mode, Phase, Stance } from '@/lib/types'

/** One phase boundary of a question (`questions.phase_log`). */
export interface PhaseLogEntry {
  phase: Phase
  at: string
}

export type SessionStatus = 'lobby' | 'active' | 'ended'

export interface SessionRow {
  id: string
  code: string
  title: string
  teacher_token: string
  budget: number
  k: number
  blind_seconds: number
  turn_seconds: number
  open_seconds: number
  current_question_id: string | null
  status: SessionStatus
  classroom_id: string | null
  /** Raw jsonb; parse with `featuresOf()` from lib/features.ts. */
  features: unknown
  created_at: string
}

export interface SessionTickRow {
  session_id: string
  version: number
  updated_at: string
}

export interface ParticipantRow {
  id: string
  session_id: string
  display_name: string
  joined_at: string
}

export interface QuestionRow {
  id: string
  session_id: string
  order_index: number
  proposition: string
  mode: Mode
  correct_answer: boolean | null
  phase: Phase
  phase_started_at: string | null
  phase_ends_at: string | null
  liquidity_b: number | null
  n_at_start: number | null
  blind_price_pct: number | null
  post_price_pct: number | null
  blind_revealed: boolean
  /** Open questions (plan §17.3): what a right answer says; the open question this was sharpened from. */
  reference_answer: string | null
  source_question_id: string | null
  /** Cascade mode (plan §17.5): the consensus is visible during blind. */
  cascade_mode: boolean
  phase_log: PhaseLogEntry[]
  /** Surprisingly popular (plan §17.2), written at snapshot. */
  sp_actual_true_pct: number | null
  sp_predicted_true_pct: number | null
  sp_answer: boolean | null
  created_at: string
}

export interface GroupRow {
  id: string
  question_id: string
  idx: number
  turn_order: string[]
  /** Socrates agent (plan §17.4): one question per speaker, in turn order. */
  socratic_questions: string[] | null
}

export interface SubmissionRow {
  id: string
  question_id: string
  participant_id: string
  reasoning: string | null
  ai_stance: Stance | null
  ai_band_lo: number | null
  ai_band_hi: number | null
  ai_reading: string | null
  blind_pct: number | null
  blind_submitted_at: string | null
  current_pct: number | null
  final_pct: number | null
  group_id: string | null
  cluster_index: number | null
  calibration_final: number | null
  calibration_blind: number | null
  persuasion: number | null
  /** Consider the opposite (plan §17.1): blind_pct is the blend of these two. */
  first_pct: number | null
  opposite_pct: number | null
  opposite_reasoning: string | null
  /** Predict the class (plan §17.2). */
  predicted_true_pct: number | null
  sp_insight: boolean | null
  /** Steelman gate (plan §17.7). */
  steelman_text: string | null
  steelman_score: number | null
  steelman_note: string | null
  /** Contrarian credit (plan §17.9a); null when not scoreable, like calibration_final. */
  contrarian_bonus: number | null
  created_at: string
  updated_at: string
}

export interface TradeRow {
  id: string
  question_id: string
  participant_id: string
  phase: 'blind' | 'open'
  pct_before: number | null
  pct_after: number
  price_before_pct: number
  price_after_pct: number
  created_at: string
}

/** Argument Elo (plan §17.9b): one pairwise comparison. */
export interface ArgumentVoteRow {
  id: string
  question_id: string
  voter_id: string
  winner_submission_id: string
  loser_submission_id: string
  created_at: string
}

export interface ClusterRow {
  id: string
  question_id: string
  idx: number
  label: string
  member_ids: string[]
}

export interface AgentRunRow {
  id: string
  agent: string
  version: number
  input_hash: string
  input: unknown
  output: unknown
  ok: boolean
  fallback: boolean
  latency_ms: number
  model: string
  created_at: string
}

/** Postgres `numeric` columns come back as strings from PostgREST. */
export function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
