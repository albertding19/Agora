/**
 * Calibration score: Brier, flipped so higher is better, shown 0–100.
 *   score = 100 · (1 − (p − y)²)
 */
import { pctToBelief } from '@/lib/market/position'

export function calibration(pct: number, outcome: boolean): number {
  const p = pctToBelief(pct)
  const y = outcome ? 1 : 0
  return 100 * (1 - (p - y) ** 2)
}

export function calibrationOrNull(pct: number | null | undefined, outcome: boolean | null): number | null {
  if (pct === null || pct === undefined || outcome === null) return null
  return calibration(pct, outcome)
}
