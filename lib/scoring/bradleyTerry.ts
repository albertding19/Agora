/**
 * Bradley-Terry strengths for pairwise "which argument is more convincing"
 * comparisons (plan 17.9b). Pure; nothing here touches the database.
 *
 * Model: P(i beats j) = pi_i / (pi_i + pi_j). Strengths are fitted with
 * Hunter's minorization-maximization (MM) iteration, anchored by a fixed
 * reference item of strength 1 that every real item has `prior` virtual
 * wins and `prior` virtual losses against:
 *
 *   pi_i <- (W_i + prior) / ( sum_{j != i} n_ij / (pi_i + pi_j) + 2 * prior / (pi_i + 1) )
 *
 * where W_i is i's wins against real items and n_ij the number of
 * comparisons between i and j in either direction. Sweeps are Jacobi
 * (every pi on the right-hand side comes from the previous sweep) and stop
 * when max |delta pi| < 1e-7 or after `iterations` sweeps.
 *
 * The reference pins the scale, an item with no comparisons sits at
 * exactly 1, and unbeaten items stay finite instead of running to infinity.
 * Comparisons naming an id that is not in `items`, or comparing an item to
 * itself, are ignored.
 *
 * `iterations` is a cap, not a target: the loop leaves as soon as the
 * tolerance is met. The cap defaults to 2000 because MM converges slowly on
 * the sparse graphs a class produces (30 arguments, ~90 comparisons): after
 * 50 sweeps the raw strengths are still 30-50% off the fixed point and the
 * top-3 ordering differs from the converged one in a few percent of such
 * classes; 2000 sweeps reach the tolerance on every shape measured (30x30,
 * 30x90, 30x300, lopsided records) in well under a millisecond, because the
 * early stop usually fires between 200 and 1200 sweeps.
 */

export interface Comparison {
  winner: string
  loser: string
}

const DEFAULT_ITERATIONS = 2000
const DEFAULT_PRIOR = 0.5
const TOLERANCE = 1e-7

export function bradleyTerry(
  items: readonly string[],
  comparisons: readonly Comparison[],
  iterations: number = DEFAULT_ITERATIONS,
  prior: number = DEFAULT_PRIOR,
): Map<string, number> {
  const ids = Array.from(new Set(items ?? []))
  const n = ids.length
  const index = new Map<string, number>()
  ids.forEach((id, i) => index.set(id, i))

  // Normalize, don't reject: a non-positive prior would divide by zero for
  // an item with no comparisons, so fall back to the default.
  const p = Number.isFinite(prior) && prior > 0 ? prior : DEFAULT_PRIOR
  const sweeps = Number.isFinite(iterations)
    ? Math.max(0, Math.floor(iterations))
    : DEFAULT_ITERATIONS

  const wins = new Float64Array(n)
  // Dense n_ij; n is a class size, so n squared is tiny.
  const counts = new Float64Array(n * n)
  for (const c of comparisons ?? []) {
    if (!c) continue
    const i = index.get(c.winner)
    const j = index.get(c.loser)
    if (i === undefined || j === undefined || i === j) continue
    wins[i] += 1
    counts[i * n + j] += 1
    counts[j * n + i] += 1
  }

  let pi = new Float64Array(n).fill(1)
  for (let s = 0; s < sweeps; s++) {
    const next = new Float64Array(n)
    let maxDelta = 0
    for (let i = 0; i < n; i++) {
      let denominator = (2 * p) / (pi[i] + 1)
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        const nij = counts[i * n + j]
        if (nij > 0) denominator += nij / (pi[i] + pi[j])
      }
      next[i] = (wins[i] + p) / denominator
      const delta = Math.abs(next[i] - pi[i])
      if (delta > maxDelta) maxDelta = delta
    }
    pi = next
    if (maxDelta < TOLERANCE) break
  }

  const out = new Map<string, number>()
  ids.forEach((id, i) => out.set(id, pi[i]))
  return out
}

/**
 * Win probability, in percent, of an argument of the given strength against
 * an uninformative argument (the reference item of strength 1):
 * 100 * pi / (pi + 1), rounded to one decimal. `winPct(1) === 50`.
 * Non-finite or non-positive input clamps to the nearest end of [0, 100].
 */
export function winPct(strength: number): number {
  if (!Number.isFinite(strength)) return strength > 0 ? 100 : 0
  if (strength <= 0) return 0
  return Math.round((1000 * strength) / (strength + 1)) / 10
}
