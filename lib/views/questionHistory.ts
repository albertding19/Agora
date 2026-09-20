/**
 * The price trajectory of one question for the Socratic arc (plan §17.6)
 * and the replay (§17.8). Built for the teacher-only history route.
 *
 * Visibility rule: the payload carries prices, phases and timestamps, plus
 * one anonymous `note` per trade — the mover's cluster label when they were
 * clustered, else their reasoning text verbatim, else null. It never
 * carries a participant id, a display name, the mover's own number, or the
 * size of their move, and anchor points have no note. Nothing in here may
 * be forwarded to a phone or the projector.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { listClusters, listSubmissions, listTrades } from '@/lib/db/queries'
import type { QuestionRow } from '@/lib/db/types'
import { priceHistoryPoints, type HistoryTrade } from '@/lib/scoring/priceHistory'
import type { QuestionHistory } from '@/lib/types'
import { round1 } from '@/lib/views/common'

export async function buildQuestionHistory(
  client: SupabaseClient,
  question: QuestionRow,
  now: Date = new Date(),
): Promise<QuestionHistory> {
  const [trades, submissions, clusters] = await Promise.all([
    listTrades(client, question.id),
    listSubmissions(client, question.id),
    listClusters(client, question.id),
  ])

  // Per mover: cluster label, else trimmed reasoning, else null. Resolved
  // here and attached to the trade so the pure history builder never sees
  // a participant id.
  const labelByIdx = new Map(clusters.map((c) => [c.idx, c.label] as const))
  const noteByParticipant = new Map<string, string | null>()
  for (const s of submissions) {
    const label = s.cluster_index === null ? null : (labelByIdx.get(s.cluster_index) ?? null)
    const reasoning = (s.reasoning ?? '').trim()
    noteByParticipant.set(s.participant_id, label ?? (reasoning || null))
  }

  const historyTrades: HistoryTrade[] = trades.map((t) => ({
    phase: t.phase,
    created_at: t.created_at,
    price_after_pct: t.price_after_pct,
    note: noteByParticipant.get(t.participant_id) ?? null,
  }))

  const points = priceHistoryPoints({
    phase: question.phase,
    cascade: question.cascade_mode,
    phaseLog: question.phase_log,
    phaseStartedAt: question.phase_started_at,
    blindPricePct: question.blind_price_pct,
    postPricePct: question.post_price_pct,
    trades: historyTrades,
    now: now.toISOString(),
  })

  return {
    questionId: question.id,
    index: question.order_index,
    proposition: question.proposition,
    mode: question.mode,
    phase: question.phase,
    outcome: question.mode === 'stem' ? question.correct_answer : null,
    cascade: question.cascade_mode,
    blindPricePct: round1(question.blind_price_pct),
    postPricePct: round1(question.post_price_pct),
    phaseLog: question.phase_log,
    points,
  }
}
