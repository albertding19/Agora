/**
 * Cascade mode (hackmit-plan.md §17.5): the same proposition run once blind
 * and once with the live consensus visible while students submit. The gap
 * between the two blind prices is herding the class experienced first-hand.
 *
 * Pure helpers only. The pair is compared at snapshot (both runs have a
 * `blind_price_pct`), not at resolve, so the pitch moment is not two phases
 * late. Readings describe the room, never a student.
 */
import type { QuestionRow } from '@/lib/db/types'

/**
 * Trim, collapse internal whitespace (any Unicode whitespace), lowercase — so
 * "0.999… < 1" matches " 0.999…  <  1 ". Tolerates a missing string (→ "").
 */
export function normalizeProposition(s: string): string {
  return (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export interface CascadePair {
  /** The non-cascade run, whose blind price is the baseline. */
  blind: QuestionRow
  /** The run with the consensus visible during blind. */
  cascade: QuestionRow
}

/**
 * The latest started cascade question that has a matching blind run.
 *
 * Cascade candidates: `cascade_mode` and past `pending`, latest `order_index`
 * first. Blind candidates: not cascade, same normalized proposition, and a
 * non-null `blind_price_pct`. The baseline is the latest blind run that
 * *preceded* the cascade run (a lower `order_index`); only when none did is
 * the latest blind run overall used, so a blind re-run added after the
 * cascade never displaces the real baseline. The first cascade question with
 * a match wins; null when nothing pairs. Blank propositions never pair. The
 * input array is not mutated.
 */
export function findCascadePair(questions: readonly QuestionRow[]): CascadePair | null {
  const byLatest = (a: QuestionRow, b: QuestionRow) => b.order_index - a.order_index

  const cascades = questions
    .filter((q) => q.cascade_mode && q.phase !== 'pending')
    .sort(byLatest)
  if (cascades.length === 0) return null

  const blinds = questions
    .filter((q) => !q.cascade_mode && q.blind_price_pct !== null)
    .sort(byLatest)
  if (blinds.length === 0) return null

  for (const cascade of cascades) {
    const key = normalizeProposition(cascade.proposition)
    if (key === '') continue
    const matches = blinds.filter((q) => normalizeProposition(q.proposition) === key)
    if (matches.length === 0) continue
    const blind = matches.find((q) => q.order_index < cascade.order_index) ?? matches[0]
    return { blind, cascade }
  }
  return null
}

export const HERDING_GAP = 10
export const SMALL_GAP = 5

/** |n| rounded to one decimal, printed without a trailing ".0" (12 → "12", 12.34 → "12.3"). */
function points(n: number): string {
  return String(Number(Math.abs(n).toFixed(1)))
}

/**
 * One sentence on what seeing the consensus did to the class. A move is
 * "toward the majority" when it has the same sign as the blind lean; a blind
 * price of exactly 50 has no majority, so nothing counts as toward it.
 */
export function cascadeReading(blindPct: number, cascadePct: number): string {
  const gap = cascadePct - blindPct
  const size = Math.abs(gap)
  const towardMajority = blindPct !== 50 && Math.sign(gap) === Math.sign(blindPct - 50)

  if (size >= HERDING_GAP && towardMajority) {
    return `Seeing the consensus pulled the class ${points(gap)} points further toward it. That is herding — a dynamic of the room, not of any one student.`
  }
  if (size >= SMALL_GAP && towardMajority) {
    return 'A small pull toward the visible consensus.'
  }
  if (size >= SMALL_GAP) {
    return `The class moved ${points(gap)} points away from the visible consensus. No herding here.`
  }
  return 'Seeing the consensus barely moved the class.'
}
