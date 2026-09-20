/**
 * The price trajectory of one question as a list of anonymous points
 * (plan §17.6, the Socratic arc; reused by §17.8, replay).
 *
 * Pure: the caller loads the question, its phase log and its trades and
 * hands them in. Every point carries the phase it belongs to so the chart
 * can label phase bands without re-deriving them from timestamps, and a
 * `note` (the mover's cluster label or anonymous reasoning, supplied by the
 * caller on the trade) or null on anchor points. Nothing here ever sees a
 * participant id or a display name.
 *
 * Points, in order (each rule only when it applies):
 *
 *   1. cascade questions only: 50% at the start of the blind phase, then one
 *      point per blind trade (the consensus was visible while phones submitted);
 *   2. the blind price at the snapshot moment, once the phase is snapshot or later;
 *   3. an anchor at the start of the open phase at the blind price (nobody can
 *      revise before open, so the structured round draws flat);
 *   4. one point per open trade;
 *   5. the post-debate price at the resolved moment.
 *
 * A question that has not started, or a non-cascade question still in the
 * blind phase, has no history: `[]`.
 *
 * Timestamps come from `phase_log`. Rows written before migration 0002 have
 * an empty log (and a question that was mid-flight when 0002 was applied has
 * a log that starts at a later phase), so each rule falls back to the same
 * approximation the dashboard used before: the current phase's start when it
 * is the phase in question, else the next logged phase, else the first open
 * trade's time, else `now`. Whatever the fallback, the points' timestamps
 * never run backwards.
 */
import { PHASES, type HistoryPoint, type Phase, type PhaseLogEntry } from '@/lib/types'
import { phaseLogAt } from '@/lib/phases/machine'
import { roundPct } from '@/lib/market/lmsr'

/** The slice of a trade row this module reads; `note` is attached by the caller. */
export interface HistoryTrade {
  phase: 'blind' | 'open'
  created_at: string
  price_after_pct: number
  note?: string | null
}

export interface PriceHistoryInput {
  phase: Phase
  cascade: boolean
  phaseLog: readonly PhaseLogEntry[]
  phaseStartedAt: string | null
  blindPricePct: number | null
  postPricePct: number | null
  /** In chronological order (the trades query orders by created_at). Input order is kept. */
  trades: readonly HistoryTrade[]
  /** ISO timestamp; the last-resort fallback for a point with no better time. */
  now: string
}

/**
 * Local phase compare so this module stays free of the view/DB layer
 * (`lib/views/common.ts` drags the Supabase client into anything that
 * imports it, and the arc chart is a client component).
 */
function phaseAtLeast(phase: Phase, floor: Phase): boolean {
  return PHASES.indexOf(phase) >= PHASES.indexOf(floor)
}

function pct1(v: number): number {
  return roundPct(v, 1)
}

export function priceHistoryPoints(input: PriceHistoryInput): HistoryPoint[] {
  const { phase, phaseLog, phaseStartedAt, blindPricePct, postPricePct, now } = input
  if (phase === 'pending') return []
  if (!input.cascade && phase === 'blind') return []

  const blindTrades = input.trades.filter((tr) => tr.phase === 'blind')
  const openTrades = input.trades.filter((tr) => tr.phase === 'open')
  const points: HistoryPoint[] = []

  // 1. Cascade: the consensus was visible during blind, so its path is part of the arc.
  //    Without a `blind` log entry the start is approximated by, in order: the
  //    phase start while still in blind, the first blind trade, the earliest
  //    log entry (never later than the phase it precedes), the phase start, now.
  if (input.cascade) {
    const t =
      phaseLogAt(phaseLog, 'blind') ??
      (phase === 'blind' ? phaseStartedAt : null) ??
      blindTrades[0]?.created_at ??
      phaseLog[0]?.at ??
      phaseStartedAt ??
      now
    points.push({ t, pct: 50, phase: 'blind', note: null })
    for (const tr of blindTrades) {
      points.push({ t: tr.created_at, pct: pct1(tr.price_after_pct), phase: 'blind', note: tr.note ?? null })
    }
  }

  // 2. The blind price, frozen at the snapshot moment. Without a `snapshot`
  //    log entry: the phase start while still in snapshot, else the next
  //    logged phase (a log that began mid-question), else the first open
  //    trade, else the phase start, else now. Each candidate is no later than
  //    the open anchor of rule 3, so the line never runs backwards.
  if (blindPricePct !== null && phaseAtLeast(phase, 'snapshot')) {
    const t =
      phaseLogAt(phaseLog, 'snapshot') ??
      (phase === 'snapshot' ? phaseStartedAt : null) ??
      phaseLogAt(phaseLog, 'structured') ??
      phaseLogAt(phaseLog, 'open') ??
      openTrades[0]?.created_at ??
      phaseStartedAt ??
      now
    points.push({ t, pct: pct1(blindPricePct), phase: 'snapshot', note: null })
  }

  // 3. Anchor at the start of open: the structured round draws flat at the blind price.
  if (blindPricePct !== null && phaseAtLeast(phase, 'open')) {
    const openAt = phaseLogAt(phaseLog, 'open')
    if (openAt !== null) points.push({ t: openAt, pct: pct1(blindPricePct), phase: 'open', note: null })
  }

  // 4. Every revision during the open discussion.
  for (const tr of openTrades) {
    points.push({ t: tr.created_at, pct: pct1(tr.price_after_pct), phase: 'open', note: tr.note ?? null })
  }

  // 5. The post-debate price at resolution.
  if (phase === 'resolved' && postPricePct !== null) {
    points.push({
      t: phaseLogAt(phaseLog, 'resolved') ?? phaseStartedAt ?? now,
      pct: pct1(postPricePct),
      phase: 'resolved',
      note: null,
    })
  }

  return points
}
