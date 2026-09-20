import { describe, expect, it } from 'vitest'
import type { HistoryPoint, PhaseLogEntry } from '@/lib/types'
import { ARC_TIME_MODE_MIN_MS, arcBands, arcX, describeArc } from './arc'

const T0 = Date.parse('2026-09-20T10:00:00.000Z')
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString()
const pt = (t: string, pct: number, phase: HistoryPoint['phase'], note: string | null = null): HistoryPoint => ({
  t,
  pct,
  phase,
  note,
})

const FULL_LOG: PhaseLogEntry[] = [
  { phase: 'blind', at: at(0) },
  { phase: 'snapshot', at: at(60) },
  { phase: 'structured', at: at(90) },
  { phase: 'open', at: at(180) },
  { phase: 'resolved', at: at(240) },
]

/** A cascade question that ran for four minutes. */
const CASCADE_POINTS: HistoryPoint[] = [
  pt(at(0), 50, 'blind'),
  pt(at(10), 60, 'blind'),
  pt(at(20), 70, 'blind'),
  pt(at(60), 68.4, 'snapshot'),
  pt(at(180), 68.4, 'open'),
  pt(at(190), 55, 'open', 'subtract first'),
  pt(at(200), 40, 'open'),
  pt(at(240), 40, 'resolved'),
]

/** The same shape driven by the simulator in under two seconds. */
const FAST_LOG: PhaseLogEntry[] = [
  { phase: 'blind', at: at(0) },
  { phase: 'snapshot', at: at(0.3) },
  { phase: 'structured', at: at(0.5) },
  { phase: 'open', at: at(0.8) },
  { phase: 'resolved', at: at(1.5) },
]
const FAST_POINTS: HistoryPoint[] = [
  pt(at(0.3), 82, 'snapshot'),
  pt(at(0.8), 82, 'open'),
  pt(at(0.9), 65, 'open'),
  pt(at(1.0), 45, 'open'),
  pt(at(1.5), 40, 'resolved'),
]

describe('arcX', () => {
  it('uses seconds since the first point once the span reaches 5 s, else the index', () => {
    const wide = [pt(at(0), 60, 'snapshot'), pt(at(ARC_TIME_MODE_MIN_MS / 1000), 60, 'open')]
    expect(arcX(wide)).toEqual({ mode: 'time', xs: [0, 5] })
    const narrow = [pt(at(0), 60, 'snapshot'), pt(at(4.999), 60, 'open')]
    expect(arcX(narrow)).toEqual({ mode: 'index', xs: [0, 1] })
  })

  it('maps every point in time mode and never draws backwards', () => {
    expect(arcX(CASCADE_POINTS)).toEqual({ mode: 'time', xs: [0, 10, 20, 60, 180, 190, 200, 240] })
    const skewed = [pt(at(0), 60, 'snapshot'), pt(at(30), 60, 'open'), pt(at(29), 55, 'open'), pt(at(60), 50, 'resolved')]
    expect(arcX(skewed)).toEqual({ mode: 'time', xs: [0, 30, 30, 60] })
  })

  it('falls back to the index for an empty list or an unparseable timestamp', () => {
    expect(arcX([])).toEqual({ mode: 'index', xs: [] })
    expect(arcX([pt('not a date', 60, 'snapshot'), pt(at(60), 60, 'open')])).toEqual({ mode: 'index', xs: [0, 1] })
  })
})

describe('arcBands', () => {
  it('labels the three phases from the log in time mode and marks the resolved point', () => {
    const { xs } = arcX(CASCADE_POINTS)
    expect(arcBands(CASCADE_POINTS, FULL_LOG, xs)).toEqual({
      bands: [
        { label: 'Before debate', x1: 0, x2: 90 },
        { label: 'Structured round', x1: 90, x2: 180 },
        { label: 'Open discussion', x1: 180, x2: 240 },
      ],
      resolvedX: 240,
    })
  })

  it('ends the open band at the last revision while unresolved', () => {
    const live = CASCADE_POINTS.slice(0, -1)
    const { xs } = arcX(live)
    const { bands, resolvedX } = arcBands(live, FULL_LOG.slice(0, -1), xs)
    expect(bands.at(-1)).toEqual({ label: 'Open discussion', x1: 180, x2: 200 })
    expect(resolvedX).toBeNull()
  })

  it('uses the flat snapshot→anchor segment as the structured round in index mode', () => {
    const { mode, xs } = arcX(FAST_POINTS)
    expect(mode).toBe('index')
    expect(arcBands(FAST_POINTS, FAST_LOG, xs)).toEqual({
      bands: [
        { label: 'Structured round', x1: 0, x2: 1 },
        { label: 'Open discussion', x1: 1, x2: 4 },
      ],
      resolvedX: 4,
    })
  })

  it('draws no structured band and no empty band when the log is missing (pre-0002 rows)', () => {
    const points = [pt(at(190), 68.4, 'snapshot'), pt(at(190), 55, 'open'), pt(at(200), 40, 'open'), pt(at(240), 40, 'resolved')]
    const { mode, xs } = arcX(points)
    expect(mode).toBe('time')
    const { bands, resolvedX } = arcBands(points, [], xs)
    expect(bands).toEqual([{ label: 'Open discussion', x1: 0, x2: 50 }])
    expect(resolvedX).toBe(50)
    for (const b of bands) expect(b.x2).toBeGreaterThan(b.x1)

    // Same rows driven fast: the first revision is part of the open discussion, not "before debate".
    const fast = [pt(at(0.2), 68.4, 'snapshot'), pt(at(0.2), 55, 'open'), pt(at(0.5), 40, 'open'), pt(at(1), 40, 'resolved')]
    expect(arcBands(fast, [], arcX(fast).xs)).toEqual({
      bands: [{ label: 'Open discussion', x1: 0, x2: 3 }],
      resolvedX: 3,
    })
  })

  it('is empty for no points or a single point', () => {
    expect(arcBands([], FULL_LOG, [])).toEqual({ bands: [], resolvedX: null })
    const one = [pt(at(60), 68.4, 'snapshot')]
    expect(arcBands(one, FULL_LOG.slice(0, 3), arcX(one).xs)).toEqual({ bands: [], resolvedX: null })
  })
})

describe('describeArc', () => {
  it("tells the plan's story: confident, crossed 50 in the open discussion, resolved FALSE", () => {
    const points = [
      pt(at(60), 82, 'snapshot'),
      pt(at(180), 82, 'open'),
      pt(at(190), 65, 'open'),
      pt(at(200), 45, 'open'),
      pt(at(240), 40, 'resolved'),
    ]
    expect(describeArc({ points, blindPricePct: 82, postPricePct: 40, outcome: false, mode: 'stem' })).toBe(
      'Confident at 82% → crossed 50% during the open discussion → resolved FALSE',
    )
  })

  it('ends a humanities arc with the final number and no answer', () => {
    const points = [pt(at(60), 64, 'snapshot'), pt(at(180), 64, 'open'), pt(at(190), 70, 'open'), pt(at(240), 70, 'resolved')]
    expect(describeArc({ points, blindPricePct: 64, postPricePct: 70, outcome: null, mode: 'humanities' })).toBe(
      'Leaning at 64% → held firm → ended at 70%. No single answer.',
    )
  })

  it('omits the ending while unresolved and reports movement of 15 points or more', () => {
    const points = [pt(at(60), 90, 'snapshot'), pt(at(180), 90, 'open'), pt(at(190), 70, 'open')]
    expect(describeArc({ points, blindPricePct: 90, postPricePct: null, outcome: true, mode: 'stem' })).toBe(
      'Confident at 90% → moved 20 points',
    )
    const held = [pt(at(60), 30, 'snapshot'), pt(at(180), 30, 'open'), pt(at(190), 20, 'open')]
    expect(describeArc({ points: held, blindPricePct: 30, postPricePct: null, outcome: false, mode: 'stem' })).toBe(
      'Leaning at 30% → held firm',
    )
  })

  it('reads uncertainty within 10 points of 50 and a crossing during a cascade blind', () => {
    const points = [pt(at(0), 50, 'blind'), pt(at(10), 60, 'blind'), pt(at(20), 40, 'blind'), pt(at(60), 40, 'snapshot')]
    expect(describeArc({ points, blindPricePct: 40, postPricePct: null, outcome: true, mode: 'stem' })).toBe(
      'Uncertain at 40% → crossed 50% during the blind phase',
    )
  })

  it('does not count touching exactly 50 as a crossing, and prefers the open crossing over a blind one', () => {
    const touched = [pt(at(60), 82, 'snapshot'), pt(at(180), 82, 'open'), pt(at(190), 50, 'open'), pt(at(200), 60, 'open')]
    expect(describeArc({ points: touched, blindPricePct: 82, postPricePct: null, outcome: true, mode: 'stem' })).toBe(
      'Confident at 82% → moved 22 points',
    )
    const both = [
      pt(at(0), 50, 'blind'),
      pt(at(10), 60, 'blind'),
      pt(at(20), 40, 'blind'),
      pt(at(60), 40, 'snapshot'),
      pt(at(180), 40, 'open'),
      pt(at(190), 60, 'open'),
      pt(at(240), 60, 'resolved'),
    ]
    expect(describeArc({ points: both, blindPricePct: 40, postPricePct: 60, outcome: true, mode: 'stem' })).toBe(
      'Uncertain at 40% → crossed 50% during the open discussion → resolved TRUE',
    )
  })

  it('has nothing to say without a blind price, or with one that is not a number', () => {
    expect(describeArc({ points: [], blindPricePct: null, postPricePct: null, outcome: null, mode: 'stem' })).toBe('No arc yet.')
    expect(describeArc({ points: [], blindPricePct: Number.NaN, postPricePct: null, outcome: null, mode: 'stem' })).toBe('No arc yet.')
  })

  it('judges the start and the movement on the whole numbers it prints', () => {
    // 74.6 prints as 75, and 75 is confident; the label must not contradict the number.
    expect(describeArc({ points: [], blindPricePct: 74.6, postPricePct: null, outcome: null, mode: 'stem' })).toBe(
      'Confident at 75% → held firm',
    )
    expect(describeArc({ points: [], blindPricePct: 60.4, postPricePct: null, outcome: null, mode: 'stem' })).toBe(
      'Uncertain at 60% → held firm',
    )
    // 68 → 53 is a 15-point move on the printed numbers even though 67.5 → 52.6 is 14.9.
    const points = [pt(at(60), 67.5, 'snapshot'), pt(at(180), 67.5, 'open'), pt(at(190), 52.6, 'open')]
    expect(describeArc({ points, blindPricePct: 67.5, postPricePct: null, outcome: true, mode: 'stem' })).toBe(
      'Leaning at 68% → moved 15 points',
    )
  })

  it('sees a crossing between the blind price and the first revision even without an open anchor (pre-0002 rows)', () => {
    const noAnchor = [pt(at(190), 82, 'snapshot'), pt(at(190), 45, 'open'), pt(at(200), 40, 'open'), pt(at(240), 40, 'resolved')]
    expect(describeArc({ points: noAnchor, blindPricePct: 82, postPricePct: 40, outcome: false, mode: 'stem' })).toBe(
      'Confident at 82% → crossed 50% during the open discussion → resolved FALSE',
    )
    // The resolved point is the final open price, so a crossing there counts too.
    const atResolve = [pt(at(60), 82, 'snapshot'), pt(at(180), 82, 'open'), pt(at(190), 55, 'open'), pt(at(240), 45, 'resolved')]
    expect(describeArc({ points: atResolve, blindPricePct: 82, postPricePct: 45, outcome: false, mode: 'stem' })).toBe(
      'Confident at 82% → crossed 50% during the open discussion → resolved FALSE',
    )
  })

  it('never claims an answer for a humanities question, whatever the outcome field says', () => {
    const points = [pt(at(60), 64, 'snapshot'), pt(at(180), 64, 'open'), pt(at(190), 70, 'open'), pt(at(240), 70, 'resolved')]
    expect(describeArc({ points, blindPricePct: 64, postPricePct: 70, outcome: true, mode: 'humanities' })).toBe(
      'Leaning at 64% → held firm → ended at 70%. No single answer.',
    )
  })

  it('is deterministic', () => {
    const input = { points: CASCADE_POINTS, blindPricePct: 68.4, postPricePct: 40, outcome: false, mode: 'stem' as const }
    expect(describeArc(input)).toBe(describeArc(input))
    expect(arcBands(CASCADE_POINTS, FULL_LOG, arcX(CASCADE_POINTS).xs)).toEqual(
      arcBands(CASCADE_POINTS, FULL_LOG, arcX(CASCADE_POINTS).xs),
    )
  })
})
