/**
 * LMSR pricing over the class's net position.
 *
 * With quantities q_T and q_F the LMSR price of TRUE is
 *   p_T = e^{q_T/b} / (e^{q_T/b} + e^{q_F/b}) = σ((q_T − q_F) / b)
 * Our position map stores the signed net quantity Q = q_T − q_F directly, so
 * the price is a logistic of Q / b. See ARCHITECTURE.md §Market engine.
 *
 * Liquidity b = k · N · B makes the price invariant to class size: a class
 * whose beliefs average 75% one way prices at ≈ 78% whether N is 5 or 30.
 */
import { netPosition } from './position'

export const DEFAULT_K = 0.4
export const DEFAULT_BUDGET = 100
/** Below this many students the price would swing too far per tap. */
export const MIN_N_FOR_LIQUIDITY = 3

export function sigmoid(x: number): number {
  // Split on sign to avoid overflow in exp for large |x|.
  if (x >= 0) {
    const e = Math.exp(-x)
    return 1 / (1 + e)
  }
  const e = Math.exp(x)
  return e / (1 + e)
}

/** b = k · max(3, N) · B */
export function liquidity(nStudents: number, budget: number, k: number = DEFAULT_K): number {
  if (!(budget > 0) || !(k > 0)) throw new Error('budget and k must be positive')
  const n = Math.max(MIN_N_FOR_LIQUIDITY, Math.floor(nStudents))
  return k * n * budget
}

/** Price of TRUE in [0, 1] for a signed net position. */
export function priceFromNet(net: number, b: number): number {
  if (!(b > 0)) throw new Error('liquidity b must be positive')
  return sigmoid(net / b)
}

/** Price of TRUE as percent (unrounded) for a list of beliefs in percent. */
export function pricePct(pcts: readonly number[], budget: number, b: number): number {
  return 100 * priceFromNet(netPosition(pcts, budget), b)
}

/** Convenience: price from beliefs when liquidity is derived from the class size. */
export function pricePctForClass(
  pcts: readonly number[],
  nStudents: number,
  budget: number = DEFAULT_BUDGET,
  k: number = DEFAULT_K,
): number {
  return pricePct(pcts, budget, liquidity(nStudents, budget, k))
}

/** Round for display; internal math stays unrounded. */
export function roundPct(pct: number, decimals = 1): number {
  const f = 10 ** decimals
  return Math.round(pct * f) / f
}
