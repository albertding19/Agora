/**
 * The Socratic arc (plan §17.6): how to lay out and describe a question's
 * price history — confident → aporia (50%) → resolved.
 *
 * Everything here is pure and works on the anonymous `HistoryPoint`s from
 * lib/scoring/priceHistory.ts. The chart component only maps these numbers
 * onto axes.
 */
import type { HistoryPoint, Mode, PhaseLogEntry } from '@/lib/types'
import { phaseLogAt } from '@/lib/phases/machine'

// ---------------------------------------------------------------------------
// x axis
// ---------------------------------------------------------------------------

export type ArcXMode = 'time' | 'index'

export interface ArcX {
  mode: ArcXMode
  /** One x per point, same order. Seconds since the first point, or the point index. */
  xs: number[]
}

/** Below this span the x axis is the point index: the simulator drives a question in about two seconds. */
export const ARC_TIME_MODE_MIN_MS = 5000

/**
 * x positions for the points: seconds since the first point when the whole
 * history spans at least 5 s, else the point index. A timestamp that does
 * not parse forces index mode. In time mode xs never decrease (a point with
 * a timestamp earlier than its predecessor is drawn at the predecessor's x),
 * so a line chart never draws backwards.
 */
export function arcX(points: readonly HistoryPoint[]): ArcX {
  const n = points.length
  if (n === 0) return { mode: 'index', xs: [] }
  const times = points.map((p) => Date.parse(p.t))
  const parseable = times.every((t) => Number.isFinite(t))
  const span = parseable ? times[n - 1] - times[0] : NaN
  if (!parseable || !(span >= ARC_TIME_MODE_MIN_MS)) {
    return { mode: 'index', xs: points.map((_, i) => i) }
  }
  const xs: number[] = []
  let prev = 0
  for (const t of times) {
    const x = Math.max(prev, (t - times[0]) / 1000)
    xs.push(x)
    prev = x
  }
  return { mode: 'time', xs }
}

// ---------------------------------------------------------------------------
// Phase bands
// ---------------------------------------------------------------------------

export type ArcBandLabel = 'Before debate' | 'Structured round' | 'Open discussion'

export interface ArcBand {
  label: ArcBandLabel
  x1: number
  x2: number
}

export interface ArcBands {
  /** In x order; never a band with x1 === x2. */
  bands: ArcBand[]
  /** x of the resolved point, or null while unresolved. */
  resolvedX: number | null
}

/**
 * Phase bands in x units for the points laid out by `arcX(points).xs`.
 *
 * Three boundaries are located, then bands fill between them:
 *
 *   - the open boundary: the phase log's `open` time (time mode), else the
 *     first open-phase point when it is an anchor (the log has `open`), else
 *     the point before the first revision (no log: the open discussion began
 *     somewhere before it);
 *   - the structured boundary: the phase log's `structured` time (time mode);
 *     in index mode the flat segment from the snapshot point to the open
 *     anchor is the structured round, and it is only drawn when the log has
 *     an `open` entry (which is exactly when an anchor exists);
 *   - the end of the open discussion: the resolved point, else the last
 *     open-phase point.
 *
 * "Before debate" runs from the first blind/snapshot point to the structured
 * boundary (else the open boundary, else the last point). Any band that
 * would be empty is dropped; boundaries from the log are clamped to the
 * points' x range.
 */
export function arcBands(
  points: readonly HistoryPoint[],
  phaseLog: readonly PhaseLogEntry[],
  xs: readonly number[],
): ArcBands {
  const n = Math.min(points.length, xs.length)
  if (n === 0) return { bands: [], resolvedX: null }
  const mode = arcX(points).mode
  const xMin = xs[0]
  const xMax = xs[n - 1]

  const firstIdx = (pred: (p: HistoryPoint) => boolean): number => {
    for (let i = 0; i < n; i++) if (pred(points[i])) return i
    return -1
  }
  const lastIdx = (pred: (p: HistoryPoint) => boolean): number => {
    for (let i = n - 1; i >= 0; i--) if (pred(points[i])) return i
    return -1
  }
  /** A phase-log time as x, clamped to the drawn range; null without a usable entry. */
  const logX = (phase: 'structured' | 'open'): number | null => {
    if (mode !== 'time') return null
    const at = phaseLogAt(phaseLog, phase)
    if (at === null) return null
    const t0 = Date.parse(points[0].t)
    const t = Date.parse(at)
    if (!Number.isFinite(t0) || !Number.isFinite(t)) return null
    return Math.min(xMax, Math.max(xMin, (t - t0) / 1000))
  }

  const preIdx = firstIdx((p) => p.phase === 'blind' || p.phase === 'snapshot')
  const snapIdx = firstIdx((p) => p.phase === 'snapshot')
  const openIdx = firstIdx((p) => p.phase === 'open')
  const lastOpenIdx = lastIdx((p) => p.phase === 'open')
  const resolvedIdx = firstIdx((p) => p.phase === 'resolved')

  // The first open-phase point is the anchor exactly when the log has an
  // `open` entry (lib/scoring/priceHistory.ts rule 3). Without one the open
  // discussion began somewhere before the first revision, so the boundary
  // sits at the point before it.
  const hasAnchor = openIdx >= 0 && phaseLogAt(phaseLog, 'open') !== null
  const openStart =
    logX('open') ?? (openIdx < 0 ? null : hasAnchor ? xs[openIdx] : xs[Math.max(0, openIdx - 1)])
  let structuredStart = logX('structured')
  if (structuredStart === null && mode === 'index' && hasAnchor && snapIdx >= 0) structuredStart = xs[snapIdx]
  const openEnd = resolvedIdx >= 0 ? xs[resolvedIdx] : lastOpenIdx >= 0 ? xs[lastOpenIdx] : null

  const bands: ArcBand[] = []
  const push = (label: ArcBandLabel, x1: number | null, x2: number | null): void => {
    if (x1 !== null && x2 !== null && x2 > x1) bands.push({ label, x1, x2 })
  }
  if (preIdx >= 0) push('Before debate', xs[preIdx], structuredStart ?? openStart ?? xMax)
  push('Structured round', structuredStart, openStart)
  push('Open discussion', openStart, openEnd)

  return { bands, resolvedX: resolvedIdx >= 0 ? xs[resolvedIdx] : null }
}

// ---------------------------------------------------------------------------
// The one-line story
// ---------------------------------------------------------------------------

export const CONFIDENT_DISTANCE = 25
export const UNCERTAIN_DISTANCE = 10
export const MOVED_POINTS = 15

export interface DescribeArcInput {
  points: readonly HistoryPoint[]
  blindPricePct: number | null
  postPricePct: number | null
  outcome: boolean | null
  mode: Mode
}

function sign(pct: number): -1 | 0 | 1 {
  return pct > 50 ? 1 : pct < 50 ? -1 : 0
}

/** True when the price went from one side of 50 to the other across these points (a touch of exactly 50 is not a crossing). */
function crossedFifty(points: readonly HistoryPoint[]): boolean {
  let last: -1 | 0 | 1 = 0
  for (const p of points) {
    const s = sign(p.pct)
    if (s === 0) continue
    if (last !== 0 && s !== last) return true
    last = s
  }
  return false
}

/**
 * "Confident at 82% → crossed 50% during the open discussion → resolved FALSE".
 *
 *   start   by |blind − 50|: ≥ 25 confident, ≤ 10 uncertain, else leaning;
 *   middle  a sign change across the debate points (snapshot, open, resolved:
 *           the price cannot move between the snapshot and the open anchor and
 *           the resolved point is the final open price, so any change there
 *           happened during the open discussion — this also covers a pre-0002
 *           row with no anchor), else across the cascade blind points, else
 *           "moved N points" when the price moved ≥ 15 points from blind to
 *           the latest price, else "held firm";
 *   end     the outcome, or "ended at N%. No single answer." for humanities or
 *           when there is no outcome; omitted while unresolved.
 *
 * Every number is rounded to a whole percent first, so the label and the
 * number in the sentence always agree (74.6 is "Confident at 75%", not
 * "Leaning at 75%"). A blind price that is not a finite number reads as no
 * arc.
 *
 * Aggregates only: nothing here names a student or a group.
 */
export function describeArc(input: DescribeArcInput): string {
  const { points, postPricePct, outcome, mode } = input
  const first = points[0]
  const last = points.length ? points[points.length - 1] : undefined
  const blindRaw = input.blindPricePct ?? first?.pct ?? null
  if (blindRaw === null || !Number.isFinite(blindRaw)) return 'No arc yet.'
  const blind = Math.round(blindRaw)
  const latestRaw = postPricePct ?? last?.pct ?? blindRaw
  const latest = Number.isFinite(latestRaw) ? Math.round(latestRaw) : blind

  const distance = Math.abs(blind - 50)
  const start =
    distance >= CONFIDENT_DISTANCE
      ? `Confident at ${blind}%`
      : distance <= UNCERTAIN_DISTANCE
        ? `Uncertain at ${blind}%`
        : `Leaning at ${blind}%`

  const moved = Math.abs(latest - blind)
  let middle: string
  if (crossedFifty(points.filter((p) => p.phase !== 'blind'))) middle = 'crossed 50% during the open discussion'
  else if (crossedFifty(points.filter((p) => p.phase === 'blind'))) middle = 'crossed 50% during the blind phase'
  else if (moved >= MOVED_POINTS) middle = `moved ${moved} points`
  else middle = 'held firm'

  const parts = [start, middle]
  if (postPricePct !== null && Number.isFinite(postPricePct)) {
    if (mode !== 'humanities' && outcome !== null) parts.push(`resolved ${outcome ? 'TRUE' : 'FALSE'}`)
    else parts.push(`ended at ${Math.round(postPricePct)}%. No single answer.`)
  }
  return parts.join(' → ')
}
