/**
 * Leaderboard ordering: calibration desc, then persuasion desc, nulls last,
 * then name. Wealth is never an input here and must never become one.
 */
import type { LeaderboardRow } from '@/lib/types'

function cmpNullableDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

export function rankLeaderboard(rows: readonly LeaderboardRow[]): LeaderboardRow[] {
  return [...rows].sort(
    (a, b) =>
      cmpNullableDesc(a.calibration, b.calibration) ||
      cmpNullableDesc(a.persuasion, b.persuasion) ||
      a.name.localeCompare(b.name),
  )
}
