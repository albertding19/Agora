import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { HistoryPoint, type PhaseLogEntry } from '@/lib/types'
import { priceHistoryPoints, type HistoryTrade, type PriceHistoryInput } from './priceHistory'

const T0 = Date.parse('2026-09-20T10:00:00.000Z')
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString()

const FULL_LOG: PhaseLogEntry[] = [
  { phase: 'blind', at: at(0) },
  { phase: 'snapshot', at: at(60) },
  { phase: 'structured', at: at(90) },
  { phase: 'open', at: at(180) },
  { phase: 'resolved', at: at(240) },
]

const BLIND_TRADES: HistoryTrade[] = [
  { phase: 'blind', created_at: at(10), price_after_pct: 60, note: null },
  { phase: 'blind', created_at: at(20), price_after_pct: 70, note: 'Cluster: it adds up' },
]

const OPEN_TRADES: HistoryTrade[] = [
  { phase: 'open', created_at: at(190), price_after_pct: 55, note: 'Cluster: subtract first' },
  { phase: 'open', created_at: at(200), price_after_pct: 40 },
  { phase: 'open', created_at: at(210), price_after_pct: 35.26, note: 'the ball is five cents' },
]

function input(over: Partial<PriceHistoryInput> = {}): PriceHistoryInput {
  return {
    phase: 'resolved',
    cascade: false,
    phaseLog: FULL_LOG,
    phaseStartedAt: at(240),
    blindPricePct: 68.44,
    postPricePct: 34.6,
    trades: OPEN_TRADES,
    now: at(300),
    ...over,
  }
}

describe('priceHistoryPoints', () => {
  it('lays out a full cascade question: 50 → blind trades → snapshot → open anchor → open trades → resolved', () => {
    const points = priceHistoryPoints(input({ cascade: true, trades: [...BLIND_TRADES, ...OPEN_TRADES] }))
    expect(points).toEqual([
      { t: at(0), pct: 50, phase: 'blind', note: null },
      { t: at(10), pct: 60, phase: 'blind', note: null },
      { t: at(20), pct: 70, phase: 'blind', note: 'Cluster: it adds up' },
      { t: at(60), pct: 68.4, phase: 'snapshot', note: null },
      { t: at(180), pct: 68.4, phase: 'open', note: null },
      { t: at(190), pct: 55, phase: 'open', note: 'Cluster: subtract first' },
      { t: at(200), pct: 40, phase: 'open', note: null },
      { t: at(210), pct: 35.3, phase: 'open', note: 'the ball is five cents' },
      { t: at(240), pct: 34.6, phase: 'resolved', note: null },
    ])
    expect(z.array(HistoryPoint).parse(points)).toEqual(points)
  })

  it('lays out a non-cascade question without the blind segment', () => {
    const points = priceHistoryPoints(input())
    expect(points.map((p) => p.phase)).toEqual(['snapshot', 'open', 'open', 'open', 'open', 'resolved'])
    expect(points[0]).toEqual({ t: at(60), pct: 68.4, phase: 'snapshot', note: null })
    expect(points[1]).toEqual({ t: at(180), pct: 68.4, phase: 'open', note: null })
  })

  it('returns [] for a non-cascade question in blind, and for any pending question', () => {
    expect(priceHistoryPoints(input({ phase: 'blind', trades: [], blindPricePct: null, postPricePct: null }))).toEqual([])
    expect(priceHistoryPoints(input({ phase: 'pending', trades: [], blindPricePct: null, postPricePct: null }))).toEqual([])
    expect(priceHistoryPoints(input({ phase: 'pending', cascade: true, trades: [] }))).toEqual([])
  })

  it('shows a cascade question climbing from 50 during blind', () => {
    const points = priceHistoryPoints(
      input({
        phase: 'blind',
        cascade: true,
        phaseLog: [{ phase: 'blind', at: at(0) }],
        phaseStartedAt: at(0),
        blindPricePct: null,
        postPricePct: null,
        trades: BLIND_TRADES,
      }),
    )
    expect(points.map((p) => [p.phase, p.pct])).toEqual([
      ['blind', 50],
      ['blind', 60],
      ['blind', 70],
    ])
  })

  it('has no resolved point before resolution and no anchor before open', () => {
    const open = priceHistoryPoints(input({ phase: 'open', phaseStartedAt: at(180), postPricePct: null }))
    expect(open.map((p) => p.phase)).toEqual(['snapshot', 'open', 'open', 'open', 'open'])
    expect(open.at(-1)).toEqual({ t: at(210), pct: 35.3, phase: 'open', note: 'the ball is five cents' })

    const structured = priceHistoryPoints(
      input({ phase: 'structured', phaseStartedAt: at(90), postPricePct: null, trades: [] }),
    )
    expect(structured).toEqual([{ t: at(60), pct: 68.4, phase: 'snapshot', note: null }])
  })

  describe('rows written before migration 0002 (empty phase log)', () => {
    it('uses the first open trade for the blind point and the phase start for the resolved point', () => {
      const points = priceHistoryPoints(input({ phaseLog: [], phaseStartedAt: at(240) }))
      expect(points).toEqual([
        { t: at(190), pct: 68.4, phase: 'snapshot', note: null },
        { t: at(190), pct: 55, phase: 'open', note: 'Cluster: subtract first' },
        { t: at(200), pct: 40, phase: 'open', note: null },
        { t: at(210), pct: 35.3, phase: 'open', note: 'the ball is five cents' },
        { t: at(240), pct: 34.6, phase: 'resolved', note: null },
      ])
    })

    it('uses the first open trade for the blind point while still in open', () => {
      const points = priceHistoryPoints(input({ phase: 'open', phaseLog: [], phaseStartedAt: at(180), postPricePct: null }))
      expect(points[0]).toEqual({ t: at(190), pct: 68.4, phase: 'snapshot', note: null })
      expect(points.some((p) => p.phase === 'open' && p.pct === 68.4)).toBe(false)
    })

    it('uses the phase start while in snapshot, then falls back to it, then to now', () => {
      const snapshot = priceHistoryPoints(
        input({ phase: 'snapshot', phaseLog: [], phaseStartedAt: at(60), postPricePct: null, trades: [] }),
      )
      expect(snapshot).toEqual([{ t: at(60), pct: 68.4, phase: 'snapshot', note: null }])

      const structured = priceHistoryPoints(
        input({ phase: 'structured', phaseLog: [], phaseStartedAt: at(90), postPricePct: null, trades: [] }),
      )
      expect(structured).toEqual([{ t: at(90), pct: 68.4, phase: 'snapshot', note: null }])

      const noClock = priceHistoryPoints(
        input({ phase: 'open', phaseLog: [], phaseStartedAt: null, postPricePct: null, trades: [] }),
      )
      expect(noClock).toEqual([{ t: at(300), pct: 68.4, phase: 'snapshot', note: null }])
    })

    it('starts a cascade question at the phase start, then now', () => {
      const withClock = priceHistoryPoints(
        input({ phase: 'blind', cascade: true, phaseLog: [], phaseStartedAt: at(0), blindPricePct: null, trades: [] }),
      )
      expect(withClock).toEqual([{ t: at(0), pct: 50, phase: 'blind', note: null }])
      const noClock = priceHistoryPoints(
        input({ phase: 'blind', cascade: true, phaseLog: [], phaseStartedAt: null, blindPricePct: null, trades: [] }),
      )
      expect(noClock).toEqual([{ t: at(300), pct: 50, phase: 'blind', note: null }])
    })
  })

  describe('a log that began mid-question (0002 applied while the question ran)', () => {
    const ms = (t: string): number => Date.parse(t)
    const nonDecreasing = (points: { t: string }[]): void => {
      for (let i = 1; i < points.length; i++) expect(ms(points[i].t)).toBeGreaterThanOrEqual(ms(points[i - 1].t))
    }

    it('puts the blind point at the next logged phase, never after the open anchor', () => {
      const fromStructured = priceHistoryPoints(input({ phaseLog: FULL_LOG.slice(2), phaseStartedAt: at(240) }))
      expect(fromStructured.map((p) => [p.phase, p.t])).toEqual([
        ['snapshot', at(90)],
        ['open', at(180)],
        ['open', at(190)],
        ['open', at(200)],
        ['open', at(210)],
        ['resolved', at(240)],
      ])
      nonDecreasing(fromStructured)

      const fromOpen = priceHistoryPoints(input({ phaseLog: FULL_LOG.slice(3), phaseStartedAt: at(240) }))
      expect(fromOpen.slice(0, 2)).toEqual([
        { t: at(180), pct: 68.4, phase: 'snapshot', note: null },
        { t: at(180), pct: 68.4, phase: 'open', note: null },
      ])
      nonDecreasing(fromOpen)
    })

    it('starts a cascade question at its first blind trade, else the earliest log entry, never at the end', () => {
      const withTrades = priceHistoryPoints(
        input({ cascade: true, phaseLog: FULL_LOG.slice(1), phaseStartedAt: at(240), trades: [...BLIND_TRADES, ...OPEN_TRADES] }),
      )
      expect(withTrades[0]).toEqual({ t: at(10), pct: 50, phase: 'blind', note: null })
      nonDecreasing(withTrades)

      const noTrades = priceHistoryPoints(input({ cascade: true, phaseLog: FULL_LOG.slice(1), phaseStartedAt: at(240), trades: [] }))
      expect(noTrades[0]).toEqual({ t: at(60), pct: 50, phase: 'blind', note: null })
      nonDecreasing(noTrades)
    })

    it('never runs backwards in any phase, with or without a log', () => {
      const phases = ['blind', 'snapshot', 'structured', 'open', 'resolved'] as const
      const startOf = { blind: 0, snapshot: 60, structured: 90, open: 180, resolved: 240 } as const
      for (const phase of phases) {
        for (const cascade of [false, true]) {
          for (const phaseLog of [FULL_LOG, FULL_LOG.slice(2), [] as PhaseLogEntry[]]) {
            const past = (p: string): boolean => phases.indexOf(p as (typeof phases)[number]) <= phases.indexOf(phase)
            const points = priceHistoryPoints(
              input({
                phase,
                cascade,
                phaseLog: phaseLog.filter((e) => past(e.phase)),
                phaseStartedAt: at(startOf[phase]),
                blindPricePct: phase === 'blind' ? null : 68.44,
                postPricePct: phase === 'resolved' ? 34.6 : null,
                trades: [...BLIND_TRADES, ...(phase === 'open' || phase === 'resolved' ? OPEN_TRADES : [])],
              }),
            )
            nonDecreasing(points)
            expect(priceHistoryPoints(input({ phase, cascade, phaseLog }))).toEqual(priceHistoryPoints(input({ phase, cascade, phaseLog })))
          }
        }
      }
    })
  })

  it('never carries anything but time, price, phase and note', () => {
    const points = priceHistoryPoints(input({ cascade: true, trades: [...BLIND_TRADES, ...OPEN_TRADES] }))
    for (const p of points) expect(Object.keys(p).sort()).toEqual(['note', 'pct', 'phase', 't'])
  })
})
