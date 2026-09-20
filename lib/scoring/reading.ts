/**
 * Belief-map readings (hackmit-plan.md §6.1). One short sentence per row.
 *
 *   ~50% blind                  → "Genuine uncertainty. Teach it."
 *   ≥ 80% confident and wrong   → "Shared misconception."   (the most valuable signal)
 *   ≥ 80% confident and right   → "Skip it."
 *   large post-debate movement  → "The debate worked."
 *   small post-debate movement  → "The debate didn't."
 */
import type { Mode } from '@/lib/types'

export const UNCERTAIN_BELOW = 60
export const CONFIDENT_FROM = 80
export const LARGE_MOVEMENT = 15

export function beliefMapReading(
  blindPct: number | null,
  postPct: number | null,
  outcome: boolean | null,
  mode: Mode,
): string | null {
  // An open question has no number and no price; see openQuestionReading().
  if (mode === 'open') return null
  if (blindPct === null) return null

  const parts: string[] = []
  const majorityTrue = blindPct >= 50
  const confidence = majorityTrue ? blindPct : 100 - blindPct

  if (mode === 'humanities' || outcome === null) {
    if (confidence < UNCERTAIN_BELOW) parts.push('No consensus. Read the distribution.')
    else if (confidence >= CONFIDENT_FROM) parts.push('Strong consensus. Check for groupthink.')
    else parts.push('Leaning one way. Read the clusters.')
  } else {
    const wrong = majorityTrue !== outcome
    if (confidence < UNCERTAIN_BELOW) parts.push('Genuine uncertainty. Teach it.')
    else if (confidence >= CONFIDENT_FROM && wrong) parts.push('Shared misconception.')
    else if (confidence >= CONFIDENT_FROM) parts.push('Skip it.')
    else parts.push(wrong ? 'Leaning wrong.' : 'Leaning right.')
  }

  if (postPct !== null) {
    parts.push(Math.abs(postPct - blindPct) >= LARGE_MOVEMENT ? 'The debate worked.' : "The debate didn't.")
  }
  return parts.join(' ')
}

/** Belief-map reading for an open (free-text) question, from its cluster count once clustered. */
export function openQuestionReading(clusterCount: number | null): string {
  if (clusterCount === null || clusterCount <= 0) return 'Open question. Cluster the answers.'
  return `${clusterCount} answer ${clusterCount === 1 ? 'cluster' : 'clusters'}. Sharpen one into a proposition.`
}
