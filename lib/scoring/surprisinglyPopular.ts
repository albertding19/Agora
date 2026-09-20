/**
 * Predict the class / the surprisingly popular answer (plan §17.2; Prelec,
 * Seung & McCoy 2017). Alongside their own number, students predict what
 * percent of the class will lean TRUE. The answer that turns out more popular
 * than the class predicted is the surprisingly popular (SP) answer: the
 * humanities "winner", and on STEM a "you knew something the crowd didn't"
 * reveal for a student whose lean matched the truth while they expected most
 * of the class to disagree. Aggregates only: percentages, never counts, never
 * names.
 */

/** Below this many predictions the SP answer is not computed. */
export const MIN_SP_PREDICTIONS = 3

/**
 * Which side a number leans: TRUE above 50, FALSE below. Exactly 50 is
 * "Unsure" and leans neither way (null), as does a missing or non-finite
 * number; those rows are excluded from the leaner denominator.
 */
export function lean(pct: number | null | undefined): boolean | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null
  if (pct > 50) return true
  if (pct < 50) return false
  return null
}

export interface SpInput {
  /**
   * The number the student leans by: their own first number when consider
   * the opposite is on (the blend of two mirror numbers sits at exactly 50
   * and leans neither way, and the class prediction is made alongside the
   * first number), else their blind number; null when they never gave one.
   */
  ownPct: number | null | undefined
  /**
   * The student's prediction of the percent of the class leaning TRUE.
   * Missing (`null`, `undefined`, or non-finite) predictions are skipped, so an
   * optional `SubmissionState.predictedTruePct` threads through unchanged.
   */
  predictedTruePct: number | null | undefined
}

export interface SpResult {
  /** Percent of leaners who leaned TRUE; null when nobody leaned either way. */
  actualTruePct: number | null
  /** Mean predicted percent leaning TRUE; null below MIN_SP_PREDICTIONS. */
  predictedTruePct: number | null
  /** TRUE when more of the class leaned TRUE than predicted, FALSE when fewer; null when undecidable. */
  answer: boolean | null
}

export function surprisinglyPopular(rows: readonly SpInput[]): SpResult {
  let nTrue = 0
  let nFalse = 0
  let predictionSum = 0
  let predictionCount = 0
  for (const row of rows) {
    const side = lean(row.ownPct)
    if (side === true) nTrue += 1
    else if (side === false) nFalse += 1
    const predicted = row.predictedTruePct
    if (predicted !== null && predicted !== undefined && Number.isFinite(predicted)) {
      predictionSum += predicted
      predictionCount += 1
    }
  }

  const leaners = nTrue + nFalse
  const actualTruePct = leaners === 0 ? null : (100 * nTrue) / leaners
  const predictedTruePct = predictionCount < MIN_SP_PREDICTIONS ? null : predictionSum / predictionCount
  const answer =
    actualTruePct === null || predictedTruePct === null || actualTruePct === predictedTruePct
      ? null
      : actualTruePct > predictedTruePct

  return { actualTruePct, predictedTruePct, answer }
}

/**
 * Did this student know something the crowd didn't? True when their own lean
 * matches `reference` (the outcome on STEM, the SP answer on humanities) and
 * they expected the majority of the class to lean the other way. `ownPct` is
 * the same number `SpInput.ownPct` carries. Null when the student, their
 * prediction, or the reference has no lean.
 */
export function spInsight(
  ownPct: number | null | undefined,
  predictedTruePct: number | null | undefined,
  reference: boolean | null,
): boolean | null {
  const own = lean(ownPct)
  const expected = lean(predictedTruePct)
  if (own === null || expected === null || reference === null) return null
  return own === reference && expected !== own
}
