/**
 * Row types mirroring supabase/migrations/0001_init.sql. Hand-written on
 * purpose (no codegen step in a 24-hour build). Keep in sync with the SQL.
 */
import type { Mode, Phase, Stance } from '@/lib/types'

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
  created_at: string
}

export interface GroupRow {
  id: string
  question_id: string
  idx: number
  turn_order: string[]
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
