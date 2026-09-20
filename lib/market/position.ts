/**
 * Belief → position map.
 *
 * A student with belief `p` (0–1 that the proposition is TRUE) and per-question
 * budget `B` holds `B · (2p − 1)` quantity units: positive on TRUE, negative on
 * FALSE, zero at 50%. Their stake is the absolute value, `B · 2|p − 0.5|`,
 * which is exactly the stake rule in hackmit-plan.md §3.2. Positions are
 * cleared at the opening price, so the same map applies in the blind and the
 * open phase, which keeps the price monotone in every student's belief.
 *
 * Wealth, stake, and quantity are internal accounting only. Never display them.
 */

export function pctToBelief(pct: number): number {
  if (!Number.isFinite(pct)) throw new Error(`belief pct must be finite, got ${pct}`)
  return Math.min(100, Math.max(0, pct)) / 100
}

/** Quantity units held for a belief given in percent. */
export function position(pct: number, budget: number): number {
  return budget * (2 * pctToBelief(pct) - 1)
}

/** Stake in budget units (always ≥ 0). */
export function stake(pct: number, budget: number): number {
  return Math.abs(position(pct, budget))
}

/** Net position of a class: the sum of every student's position. */
export function netPosition(pcts: readonly number[], budget: number): number {
  let net = 0
  for (const pct of pcts) net += position(pct, budget)
  return net
}
