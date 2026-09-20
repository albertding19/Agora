/**
 * Consider the opposite (plan §17.1; dialectical bootstrapping, Herzog &
 * Hertwig 2009). A student gives a first number, then assumes it is wrong and
 * gives a second one; the blind belief the engine reads is the blend of the
 * two. The blend is the mean snapped to the slider step (5); a mean that lands
 * halfway between two steps rounds toward 50, which keeps the rule symmetric
 * between TRUE and FALSE and errs toward less confidence, which is the point.
 * The result always lies within [min, max] of the inputs, so `PctSchema` and
 * the DB check on `blind_pct` hold. Inputs are step-5 integers in practice
 * (`PctSchema`); the DB check only enforces 0–100, so off-step inputs are
 * still kept inside their own range rather than snapped past it.
 */

const STEP = 5
const MIDPOINT = 50

/**
 * Blend a first and an opposite number (both integer percent, step 5) into
 * one step-5 number. A missing opposite (`null`, `undefined`, or a non-finite
 * number) returns `first` unchanged.
 */
export function blendPct(first: number, opposite: number | null | undefined): number {
  if (opposite === null || opposite === undefined || !Number.isFinite(opposite)) return first
  const lo = Math.min(first, opposite)
  const hi = Math.max(first, opposite)
  const mean = (first + opposite) / 2
  const lower = Math.floor(mean / STEP) * STEP
  const upper = lower + STEP
  let snapped: number
  if (mean === lower) snapped = lower
  else if (mean - lower < upper - mean) snapped = lower
  else if (upper - mean < mean - lower) snapped = upper
  // Exactly halfway between two steps: round toward 50.
  else snapped = mean > MIDPOINT ? lower : upper
  // A no-op for step-5 inputs; only off-step inputs can snap outside their range.
  return Math.min(hi, Math.max(lo, snapped))
}
