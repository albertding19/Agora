/**
 * Leaderboard ordering: calibration (plus contrarian credit when enabled)
 * desc, then persuasion desc, then steelman fidelity desc, nulls last, then
 * name. Wealth is never an input here and must never become one.
 *
 * Calibration stays primary: it is the proper scoring rule, the only
 * component under which reporting your true belief is optimal. The
 * displayed calibration column stays the pure Brier number; the contrarian
 * credit only moves the rank.
 */
import type { LeaderboardRow } from '@/lib/types'

function cmpNullableDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

/** Primary rank key: calibration plus contrarian credit; null calibration stays null. */
export function rankKey(row: LeaderboardRow): number | null {
  return row.calibration === null ? null : row.calibration + (row.contrarian ?? 0)
}

export function rankLeaderboard(rows: readonly LeaderboardRow[]): LeaderboardRow[] {
  return [...rows].sort(
    (a, b) =>
      cmpNullableDesc(rankKey(a), rankKey(b)) ||
      cmpNullableDesc(a.persuasion, b.persuasion) ||
      cmpNullableDesc(a.steelman ?? null, b.steelman ?? null) ||
      a.name.localeCompare(b.name),
  )
}
