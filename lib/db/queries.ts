/**
 * Typed loaders and writers over the untyped Supabase client.
 *
 * Every function takes the client explicitly (routes get it from
 * `db()` in lib/db/server.ts). Numeric columns are converted with `num()`
 * because PostgREST returns Postgres `numeric` as strings.
 */
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { HttpError } from '@/lib/http'
import { DEFAULT_K } from '@/lib/market/lmsr'
import type { DebateGroup } from '@/lib/pairing/pair'
import type { Phase } from '@/lib/types'
import {
  num,
  type ClusterRow,
  type GroupRow,
  type ParticipantRow,
  type QuestionRow,
  type SessionRow,
  type SessionTickRow,
  type SubmissionRow,
  type TradeRow,
} from './types'

type Raw = Record<string, unknown>
type Numeric = number | string | null | undefined

export const UNIQUE_VIOLATION = '23505'

function dbError(error: PostgrestError, what: string): HttpError {
  console.error(`db: ${what} failed:`, error.message, error.details ?? '')
  return new HttpError(500, 'db_error', `${what} failed`)
}

// ---------------------------------------------------------------------------
// Row mappers (numeric → number)
// ---------------------------------------------------------------------------

export function mapSession(r: Raw): SessionRow {
  return { ...(r as unknown as SessionRow), k: num(r.k as Numeric) ?? DEFAULT_K }
}

export function mapQuestion(r: Raw): QuestionRow {
  return {
    ...(r as unknown as QuestionRow),
    liquidity_b: num(r.liquidity_b as Numeric),
    blind_price_pct: num(r.blind_price_pct as Numeric),
    post_price_pct: num(r.post_price_pct as Numeric),
  }
}

export function mapSubmission(r: Raw): SubmissionRow {
  return {
    ...(r as unknown as SubmissionRow),
    calibration_final: num(r.calibration_final as Numeric),
    calibration_blind: num(r.calibration_blind as Numeric),
    persuasion: num(r.persuasion as Numeric),
  }
}

export function mapTrade(r: Raw): TradeRow {
  return {
    ...(r as unknown as TradeRow),
    price_before_pct: num(r.price_before_pct as Numeric) ?? 50,
    price_after_pct: num(r.price_after_pct as Numeric) ?? 50,
  }
}

const mapParticipant = (r: Raw): ParticipantRow => r as unknown as ParticipantRow
const mapGroup = (r: Raw): GroupRow => r as unknown as GroupRow
const mapCluster = (r: Raw): ClusterRow => r as unknown as ClusterRow

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

export interface NewSession {
  code: string
  title: string
  teacher_token: string
  budget: number
  k: number
  blind_seconds: number
  turn_seconds: number
  open_seconds: number
}

/** Returns null on a code collision (unique violation) so the caller can retry. */
export async function insertSession(client: SupabaseClient, fields: NewSession): Promise<SessionRow | null> {
  const { data, error } = await client.from('sessions').insert(fields).select().single()
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null
    throw dbError(error, 'insert session')
  }
  return mapSession(data as Raw)
}

export async function insertTick(client: SupabaseClient, sessionId: string): Promise<void> {
  const { error } = await client.from('session_ticks').insert({ session_id: sessionId })
  if (error) throw dbError(error, 'insert session tick')
}

export async function getSession(client: SupabaseClient, id: string): Promise<SessionRow | null> {
  const { data, error } = await client.from('sessions').select('*').eq('id', id).maybeSingle()
  if (error) throw dbError(error, 'load session')
  return data ? mapSession(data as Raw) : null
}

export async function getSessionByCode(client: SupabaseClient, code: string): Promise<SessionRow | null> {
  const { data, error } = await client.from('sessions').select('*').eq('code', code).maybeSingle()
  if (error) throw dbError(error, 'load session by code')
  return data ? mapSession(data as Raw) : null
}

export async function updateSession(
  client: SupabaseClient,
  id: string,
  fields: Partial<Omit<SessionRow, 'id'>>,
): Promise<SessionRow> {
  const { data, error } = await client.from('sessions').update(fields).eq('id', id).select().single()
  if (error) throw dbError(error, 'update session')
  return mapSession(data as Raw)
}

export async function getTickVersion(client: SupabaseClient, sessionId: string): Promise<number> {
  const { data, error } = await client
    .from('session_ticks')
    .select('version')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error) throw dbError(error, 'load session tick')
  return Number((data as Partial<SessionTickRow> | null)?.version ?? 0)
}

/** Atomic increment via the `bump_tick` SQL function. Never throws: a missed poke only costs poll latency. */
export async function bumpTick(client: SupabaseClient, sessionId: string): Promise<void> {
  const { error } = await client.rpc('bump_tick', { sid: sessionId })
  if (error) console.error('bump_tick failed', sessionId, error.message)
}

// ---------------------------------------------------------------------------
// participants
// ---------------------------------------------------------------------------

export async function insertParticipant(
  client: SupabaseClient,
  sessionId: string,
  displayName: string,
): Promise<ParticipantRow> {
  const { data, error } = await client
    .from('participants')
    .insert({ session_id: sessionId, display_name: displayName })
    .select()
    .single()
  if (error) throw dbError(error, 'insert participant')
  return mapParticipant(data as Raw)
}

export async function getParticipant(client: SupabaseClient, id: string): Promise<ParticipantRow | null> {
  const { data, error } = await client.from('participants').select('*').eq('id', id).maybeSingle()
  if (error) throw dbError(error, 'load participant')
  return data ? mapParticipant(data as Raw) : null
}

export async function listParticipants(client: SupabaseClient, sessionId: string): Promise<ParticipantRow[]> {
  const { data, error } = await client
    .from('participants')
    .select('*')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true })
  if (error) throw dbError(error, 'list participants')
  return ((data ?? []) as Raw[]).map(mapParticipant)
}

// ---------------------------------------------------------------------------
// questions
// ---------------------------------------------------------------------------

export interface NewQuestion {
  proposition: string
  mode: 'stem' | 'humanities'
  correct_answer: boolean | null
}

export async function insertQuestions(
  client: SupabaseClient,
  sessionId: string,
  inputs: NewQuestion[],
): Promise<QuestionRow[]> {
  const { data: last, error: lastErr } = await client
    .from('questions')
    .select('order_index')
    .eq('session_id', sessionId)
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lastErr) throw dbError(lastErr, 'read last question index')
  const start = last ? Number((last as { order_index: number }).order_index) + 1 : 0

  const rows = inputs.map((q, i) => ({ session_id: sessionId, order_index: start + i, ...q }))
  const { data, error } = await client.from('questions').insert(rows).select().order('order_index')
  if (error) throw dbError(error, 'insert questions')
  return ((data ?? []) as Raw[]).map(mapQuestion)
}

export async function getQuestion(client: SupabaseClient, id: string): Promise<QuestionRow | null> {
  const { data, error } = await client.from('questions').select('*').eq('id', id).maybeSingle()
  if (error) throw dbError(error, 'load question')
  return data ? mapQuestion(data as Raw) : null
}

export async function listQuestions(client: SupabaseClient, sessionId: string): Promise<QuestionRow[]> {
  const { data, error } = await client
    .from('questions')
    .select('*')
    .eq('session_id', sessionId)
    .order('order_index', { ascending: true })
  if (error) throw dbError(error, 'list questions')
  return ((data ?? []) as Raw[]).map(mapQuestion)
}

/**
 * Update a question. With `guard`, the update only applies while the row is
 * still in that phase; returns null if the guard failed (someone else won).
 */
export async function updateQuestion(
  client: SupabaseClient,
  id: string,
  fields: Partial<Omit<QuestionRow, 'id' | 'session_id' | 'created_at'>>,
  guard?: { phase: Phase },
): Promise<QuestionRow | null> {
  let query = client.from('questions').update(fields).eq('id', id)
  if (guard) query = query.eq('phase', guard.phase)
  const { data, error } = await query.select().maybeSingle()
  if (error) throw dbError(error, 'update question')
  return data ? mapQuestion(data as Raw) : null
}

// ---------------------------------------------------------------------------
// submissions
// ---------------------------------------------------------------------------

export async function listSubmissions(client: SupabaseClient, questionId: string): Promise<SubmissionRow[]> {
  const { data, error } = await client
    .from('submissions')
    .select('*')
    .eq('question_id', questionId)
    .order('created_at', { ascending: true })
  if (error) throw dbError(error, 'list submissions')
  return ((data ?? []) as Raw[]).map(mapSubmission)
}

export async function listSubmissionsForQuestions(
  client: SupabaseClient,
  questionIds: string[],
): Promise<SubmissionRow[]> {
  if (questionIds.length === 0) return []
  const { data, error } = await client.from('submissions').select('*').in('question_id', questionIds)
  if (error) throw dbError(error, 'list submissions for questions')
  return ((data ?? []) as Raw[]).map(mapSubmission)
}

export async function getSubmission(
  client: SupabaseClient,
  questionId: string,
  participantId: string,
): Promise<SubmissionRow | null> {
  const { data, error } = await client
    .from('submissions')
    .select('*')
    .eq('question_id', questionId)
    .eq('participant_id', participantId)
    .maybeSingle()
  if (error) throw dbError(error, 'load submission')
  return data ? mapSubmission(data as Raw) : null
}

export type SubmissionPatch = Partial<
  Pick<
    SubmissionRow,
    | 'reasoning'
    | 'ai_stance'
    | 'ai_band_lo'
    | 'ai_band_hi'
    | 'ai_reading'
    | 'blind_pct'
    | 'blind_submitted_at'
    | 'current_pct'
    | 'final_pct'
    | 'group_id'
    | 'cluster_index'
    | 'calibration_final'
    | 'calibration_blind'
    | 'persuasion'
  >
>

/** Insert-or-update one student's row for a question. Only the given columns change. */
export async function upsertSubmission(
  client: SupabaseClient,
  questionId: string,
  participantId: string,
  patch: SubmissionPatch,
): Promise<SubmissionRow> {
  const { data, error } = await client
    .from('submissions')
    .upsert(
      { question_id: questionId, participant_id: participantId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'question_id,participant_id' },
    )
    .select()
    .single()
  if (error) throw dbError(error, 'upsert submission')
  return mapSubmission(data as Raw)
}

/** Bulk patch of existing rows (scores, cluster indexes). Rows must already exist. */
export async function upsertSubmissionPatches(
  client: SupabaseClient,
  questionId: string,
  patches: { participantId: string; patch: SubmissionPatch }[],
): Promise<void> {
  if (patches.length === 0) return
  const now = new Date().toISOString()
  const rows = patches.map(({ participantId, patch }) => ({
    question_id: questionId,
    participant_id: participantId,
    ...patch,
    updated_at: now,
  }))
  const { error } = await client.from('submissions').upsert(rows, { onConflict: 'question_id,participant_id' })
  if (error) throw dbError(error, 'bulk update submissions')
}

// ---------------------------------------------------------------------------
// trades
// ---------------------------------------------------------------------------

export interface NewTrade {
  question_id: string
  participant_id: string
  phase: 'blind' | 'open'
  pct_before: number | null
  pct_after: number
  price_before_pct: number
  price_after_pct: number
}

export async function insertTrade(client: SupabaseClient, trade: NewTrade): Promise<void> {
  const { error } = await client.from('trades').insert(trade)
  if (error) throw dbError(error, 'insert trade')
}

export async function listTrades(client: SupabaseClient, questionId: string): Promise<TradeRow[]> {
  const { data, error } = await client
    .from('trades')
    .select('*')
    .eq('question_id', questionId)
    .order('created_at', { ascending: true })
  if (error) throw dbError(error, 'list trades')
  return ((data ?? []) as Raw[]).map(mapTrade)
}

// ---------------------------------------------------------------------------
// groups
// ---------------------------------------------------------------------------

export async function listGroups(client: SupabaseClient, questionId: string): Promise<GroupRow[]> {
  const { data, error } = await client
    .from('groups')
    .select('*')
    .eq('question_id', questionId)
    .order('idx', { ascending: true })
  if (error) throw dbError(error, 'list groups')
  return ((data ?? []) as Raw[]).map(mapGroup)
}

/**
 * Idempotent: upserts on (question_id, idx), deletes stale higher indexes from
 * an earlier run, and points each member's submission at its group.
 */
export async function upsertGroups(
  client: SupabaseClient,
  questionId: string,
  groups: DebateGroup[],
): Promise<GroupRow[]> {
  let saved: GroupRow[] = []
  if (groups.length > 0) {
    const rows = groups.map((g) => ({ question_id: questionId, idx: g.idx, turn_order: g.turnOrder }))
    const { data, error } = await client
      .from('groups')
      .upsert(rows, { onConflict: 'question_id,idx' })
      .select()
      .order('idx')
    if (error) throw dbError(error, 'upsert groups')
    saved = ((data ?? []) as Raw[]).map(mapGroup)
  }
  const { error: delErr } = await client
    .from('groups')
    .delete()
    .eq('question_id', questionId)
    .gte('idx', groups.length)
  if (delErr) throw dbError(delErr, 'delete stale groups')

  for (const g of saved) {
    if (g.turn_order.length === 0) continue
    const { error } = await client
      .from('submissions')
      .update({ group_id: g.id })
      .eq('question_id', questionId)
      .in('participant_id', g.turn_order)
    if (error) throw dbError(error, 'assign submissions to group')
  }
  return saved
}

// ---------------------------------------------------------------------------
// clusters
// ---------------------------------------------------------------------------

export async function listClusters(client: SupabaseClient, questionId: string): Promise<ClusterRow[]> {
  const { data, error } = await client
    .from('clusters')
    .select('*')
    .eq('question_id', questionId)
    .order('idx', { ascending: true })
  if (error) throw dbError(error, 'list clusters')
  return ((data ?? []) as Raw[]).map(mapCluster)
}

export async function replaceClusters(
  client: SupabaseClient,
  questionId: string,
  clusters: { idx: number; label: string; member_ids: string[] }[],
): Promise<ClusterRow[]> {
  const { error: delErr } = await client.from('clusters').delete().eq('question_id', questionId)
  if (delErr) throw dbError(delErr, 'delete clusters')
  if (clusters.length === 0) return []
  const rows = clusters.map((c) => ({ question_id: questionId, ...c }))
  const { data, error } = await client.from('clusters').insert(rows).select().order('idx')
  if (error) throw dbError(error, 'insert clusters')
  return ((data ?? []) as Raw[]).map(mapCluster)
}
