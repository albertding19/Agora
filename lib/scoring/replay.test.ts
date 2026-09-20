import { describe, expect, it } from 'vitest'
import { QuestionHistory, type HistoryPoint } from '@/lib/types'
import { arcX } from './arc'
import { REPLAY_MS, replayRevealCount, replaySummary } from './replay'

const T0 = Date.parse('2026-09-20T10:00:00.000Z')
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString()
const pt = (t: string, pct: number, phase: HistoryPoint['phase'], note: string | null = null): HistoryPoint => ({
  t,
  pct,
  phase,
  note,
})

/** Four points over ten seconds: time mode. */
const TIMED: HistoryPoint[] = [pt(at(0), 82, 'snapshot'), pt(at(1), 82, 'open'), pt(at(9), 45, 'open'), pt(at(10), 40, 'resolved')]
/** Four points inside one second: index mode. */
const FAST: HistoryPoint[] = [pt(at(0), 82, 'snapshot'), pt(at(0.1), 82, 'open'), pt(at(0.2), 45, 'open'), pt(at(0.3), 40, 'resolved')]

function sweep(points: readonly HistoryPoint[]): number[] {
  const counts: number[] = []
  for (let i = 0; i <= 100; i++) counts.push(replayRevealCount(points, i / 100))
  return counts
}

describe('replayRevealCount', () => {
  it('is 0 at progress 0 and every point at progress 1', () => {
    for (const points of [TIMED, FAST]) {
      expect(replayRevealCount(points, 0)).toBe(0)
      expect(replayRevealCount(points, 1)).toBe(points.length)
    }
    expect(replayRevealCount([], 0.5)).toBe(0)
  })

  it('never decreases as progress grows', () => {
    for (const points of [TIMED, FAST]) {
      const counts = sweep(points)
      for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
      expect(counts[0]).toBe(0)
      expect(counts.at(-1)).toBe(points.length)
    }
  })

  it('follows the clock in time mode and the index otherwise', () => {
    expect(arcX(TIMED).mode).toBe('time')
    // 0 s and 1 s are within the first half of a 10 s span; 9 s and 10 s are not.
    expect(replayRevealCount(TIMED, 0.5)).toBe(2)
    expect(replayRevealCount(TIMED, 0.05)).toBe(1)
    expect(replayRevealCount(TIMED, 0.9)).toBe(3)

    expect(arcX(FAST).mode).toBe('index')
    expect(replayRevealCount(FAST, 0.5)).toBe(2)
    expect(replayRevealCount(FAST, 0.26)).toBe(1)
    expect(replayRevealCount(FAST, 0.76)).toBe(3)
  })

  it('clamps progress and treats a non-number as the start', () => {
    expect(replayRevealCount(TIMED, 1.7)).toBe(TIMED.length)
    expect(replayRevealCount(TIMED, -0.3)).toBe(0)
    expect(replayRevealCount(TIMED, Number.NaN)).toBe(0)
  })

  it('runs for twenty seconds', () => {
    expect(REPLAY_MS).toBe(20000)
  })
})

describe('replaySummary', () => {
  const history = QuestionHistory.parse({
    questionId: '5f2c1b52-3f64-4a4a-9d3e-0a1b2c3d4e5f',
    index: 0,
    proposition: 'The ball costs 10 cents.',
    mode: 'stem',
    phase: 'resolved',
    outcome: false,
    cascade: false,
    blindPricePct: 82,
    postPricePct: 40,
    phaseLog: [
      { phase: 'blind', at: at(0) },
      { phase: 'snapshot', at: at(60) },
      { phase: 'structured', at: at(90) },
      { phase: 'open', at: at(180) },
      { phase: 'resolved', at: at(240) },
    ],
    points: [
      pt(at(60), 82, 'snapshot'),
      pt(at(180), 82, 'open'),
      pt(at(190), 65, 'open', 'Cluster: subtract the dollar first'),
      pt(at(200), 45, 'open', '  '),
      pt(at(210), 42, 'open', 'if the ball were 10 cents the bat would be 1.10 and the total 1.20'),
      pt(at(240), 40, 'resolved'),
    ],
  })

  it('lists the proposition, the arc, then every note as a bullet in order', () => {
    expect(replaySummary(history)).toBe(
      [
        'The ball costs 10 cents.',
        'Confident at 82% → crossed 50% during the open discussion → resolved FALSE',
        '- Cluster: subtract the dollar first',
        '- if the ball were 10 cents the bat would be 1.10 and the total 1.20',
      ].join('\n'),
    )
  })

  it('carries nothing about any participant', () => {
    const json = JSON.stringify(history).toLowerCase()
    expect(json).not.toContain('participant')
    expect(json).not.toContain('name')
    const summary = replaySummary(history).toLowerCase()
    expect(summary).not.toContain('participant')
    expect(summary).not.toContain('name')
  })

  it('has no bullets when nothing moved the price', () => {
    const quiet = { ...history, points: history.points.map((p) => ({ ...p, note: null })) }
    expect(replaySummary(quiet).split('\n')).toHaveLength(2)
  })

  it('keeps every note on one bullet line and skips notes that are only whitespace', () => {
    const notes = ['first line\nsecond\tline  \r\n', '\u00a0\u2003', 'plain']
    const messy = { ...history, points: history.points.map((p, i) => ({ ...p, note: notes[i] ?? null })) }
    expect(replaySummary(messy).split('\n')).toEqual([
      'The ball costs 10 cents.',
      'Confident at 82% → crossed 50% during the open discussion → resolved FALSE',
      '- first line second line',
      '- plain',
    ])
    expect(replaySummary(messy)).toBe(replaySummary(messy))
  })

  it('collapses consecutive identical notes into one bullet but keeps a note that returns later', () => {
    // Several slider commits under one note, then another note, then the first note again.
    const notes = [null, 'Cluster: subtract the dollar first', 'Cluster:  subtract the dollar first\n', 'Cluster: subtract the dollar first', 'plain', 'Cluster: subtract the dollar first']
    const repeated = { ...history, points: history.points.map((p, i) => ({ ...p, note: notes[i] ?? null })) }
    expect(replaySummary(repeated).split('\n')).toEqual([
      'The ball costs 10 cents.',
      'Confident at 82% → crossed 50% during the open discussion → resolved FALSE',
      '- Cluster: subtract the dollar first',
      '- plain',
      '- Cluster: subtract the dollar first',
    ])
  })

  it('does not let a blank note break a run of identical notes', () => {
    const notes = [null, 'same', '  ', 'same', null, null]
    const gapped = { ...history, points: history.points.map((p, i) => ({ ...p, note: notes[i] ?? null })) }
    expect(replaySummary(gapped).split('\n')).toEqual([
      'The ball costs 10 cents.',
      'Confident at 82% → crossed 50% during the open discussion → resolved FALSE',
      '- same',
    ])
  })
})
