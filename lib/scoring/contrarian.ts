/**
 * Contrarian credit (plan §17.9a). A student who leaned the right way while
 * the class as a whole (the blind price) leaned the wrong way earns credit
 * worth half the crowd's error in points, capped at 25: a shared misconception
 * (blind price ≥ 80) is worth ≥ 15, and LMSR compression keeps realistic
 * values ≤ ~21. Zero for everyone else, including students at exactly 50 and
 * questions where the crowd was right or evenly split. Always computed at
 * resolution; the views gate it on the `contrarianCredit` flag, and the
 * leaderboard adds it to calibration for ranking while showing it separately.
 */
import { lean } from './surprisinglyPopular'

/** Fraction of the crowd's error (in points from 50) credited to a right contrarian. */
export const CONTRARIAN_RATE = 0.5
/** Upper bound on the credit, in points. */
export const CONTRARIAN_MAX = 25

export function contrarianBonus(blindPct: number | null | undefined, blindPricePct: number, outcome: boolean): number {
  const crowd = lean(blindPricePct)
  if (crowd === null || crowd === outcome) return 0
  if (lean(blindPct) !== outcome) return 0
  return Math.min(CONTRARIAN_MAX, Math.round(CONTRARIAN_RATE * Math.abs(blindPricePct - 50)))
}
