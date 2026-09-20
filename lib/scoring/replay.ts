/**
 * Replay (plan §17.8): the numbers behind the 20-second time-lapse of a
 * question's price and the text export next to it.
 *
 * Pure. The component owns the animation loop; it calls
 * `replayRevealCount` each frame and hands the count to the chart's
 * `revealUpTo`. Anonymity: a `QuestionHistory` carries no participant id,
 * name, per-student number or move size, so nothing here can leak one.
 */
import type { HistoryPoint, QuestionHistory } from '@/lib/types'
import { arcX, describeArc } from '@/lib/scoring/arc'

/** Length of one full replay. */
export const REPLAY_MS = 20000

/**
 * How many leading points are revealed at `progress` in [0, 1]:
 * 0 at 0, all of them at 1, never decreasing in between. When the arc is
 * drawn in time mode the reveal follows the clock (a point appears once
 * `progress` reaches its position in the span), so a burst of revisions
 * plays as a burst; in index mode points appear one by one at an even pace.
 */
export function replayRevealCount(points: readonly HistoryPoint[], progress: number): number {
  const n = points.length
  if (n === 0) return 0
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
  if (p <= 0) return 0
  if (p >= 1) return n
  const x = arcX(points)
  if (x.mode === 'time') {
    const span = x.xs[n - 1] - x.xs[0]
    if (!(span > 0)) return n
    let count = 0
    for (const v of x.xs) {
      if ((v - x.xs[0]) / span <= p) count++
      else break
    }
    return count
  }
  return Math.floor(p * n)
}

/**
 * Plain-text summary for "Copy summary": the proposition, the arc in one
 * line, then every note that moved the price as a bullet, in order. A note
 * is one bullet on one line: its internal whitespace (a newline typed into
 * the reasoning box) collapses to single spaces; blank notes are skipped.
 */
export function replaySummary(history: QuestionHistory): string {
  const lines = [
    history.proposition,
    describeArc({
      points: history.points,
      blindPricePct: history.blindPricePct,
      postPricePct: history.postPricePct,
      outcome: history.outcome,
      mode: history.mode,
    }),
  ]
  for (const p of history.points) {
    const note = p.note?.replace(/\s+/g, ' ').trim()
    if (note) lines.push(`- ${note}`)
  }
  return lines.join('\n')
}
