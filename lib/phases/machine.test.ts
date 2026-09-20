import { describe, expect, it } from 'vitest'
import {
  autoAdvanceTarget,
  computeResolution,
  computeSnapshot,
  livePricePct,
  nextPhase,
  phaseDurationSeconds,
  speakerIndex,
  timerExpired,
} from './machine'
import { liquidity } from '@/lib/market/lmsr'

const timers = { blindSeconds: 75, turnSeconds: 30, openSeconds: 60 }
const B = 100
const b = liquidity(5, B, 0.4)

describe('phase order and timers', () => {
  it('walks the six phases', () => {
    expect(nextPhase('pending')).toBe('blind')
    expect(nextPhase('blind')).toBe('snapshot')
    expect(nextPhase('snapshot')).toBe('structured')
    expect(nextPhase('structured')).toBe('open')
    expect(nextPhase('open')).toBe('resolved')
    expect(nextPhase('resolved')).toBeNull()
  })

  it('sizes the structured round by the largest group', () => {
    expect(phaseDurationSeconds('blind', timers, 3)).toBe(75)
    expect(phaseDurationSeconds('structured', timers, 5)).toBe(150)
    expect(phaseDurationSeconds('open', timers, 3)).toBe(60)
    expect(phaseDurationSeconds('snapshot', timers, 3)).toBeNull()
  })

  it('expires only after the grace period', () => {
    const ends = new Date('2026-09-20T10:00:00Z')
    expect(timerExpired(ends.toISOString(), new Date('2026-09-20T10:00:01Z'))).toBe(false)
    expect(timerExpired(ends.toISOString(), new Date('2026-09-20T10:00:03Z'))).toBe(true)
    expect(timerExpired(null, new Date())).toBe(false)
  })

  it('auto-advances timed phases but never resolves STEM without an answer', () => {
    const past = new Date('2026-09-20T09:00:00Z').toISOString()
    const now = new Date('2026-09-20T10:00:00Z')
    expect(autoAdvanceTarget({ phase: 'blind', mode: 'stem', correctAnswer: true, phaseEndsAt: past }, now)).toBe('snapshot')
    expect(autoAdvanceTarget({ phase: 'structured', mode: 'stem', correctAnswer: true, phaseEndsAt: past }, now)).toBe('open')
    expect(autoAdvanceTarget({ phase: 'open', mode: 'stem', correctAnswer: true, phaseEndsAt: past }, now)).toBe('resolved')
    expect(autoAdvanceTarget({ phase: 'open', mode: 'stem', correctAnswer: null, phaseEndsAt: past }, now)).toBeNull()
    expect(autoAdvanceTarget({ phase: 'open', mode: 'humanities', correctAnswer: null, phaseEndsAt: past }, now)).toBe('resolved')
    expect(autoAdvanceTarget({ phase: 'snapshot', mode: 'stem', correctAnswer: true, phaseEndsAt: past }, now)).toBeNull()
    expect(autoAdvanceTarget({ phase: 'blind', mode: 'stem', correctAnswer: true, phaseEndsAt: null }, now)).toBeNull()
  })

  it('computes the speaker from the clock', () => {
    const started = new Date('2026-09-20T10:00:00Z')
    expect(speakerIndex(started, new Date('2026-09-20T10:00:10Z'), 30)).toBe(0)
    expect(speakerIndex(started, new Date('2026-09-20T10:00:31Z'), 30)).toBe(1)
    expect(speakerIndex(started, new Date('2026-09-20T10:02:00Z'), 30)).toBe(4)
  })
})

describe('snapshot', () => {
  it('prices the blind numbers and groups everyone, including non-submitters', () => {
    const result = computeSnapshot({
      participantIds: ['a', 'b', 'c', 'd', 'e'],
      submissions: [
        { participantId: 'a', blindPct: 75, currentPct: null },
        { participantId: 'b', blindPct: 80, currentPct: null },
        { participantId: 'c', blindPct: 70, currentPct: null },
        { participantId: 'd', blindPct: 75, currentPct: null },
      ],
      budget: B,
      b,
    })
    // Four students averaging 75 with b sized for five: net = 200, price = σ(1) ≈ 73.1
    expect(result.blindPricePct).toBeCloseTo(73.1, 0)
    expect(result.groups).toHaveLength(1)
    expect([...result.groups[0].turnOrder].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(result.groups[0].turnOrder.at(-1)).toBe('e') // non-submitter speaks last
  })
})

describe('live price', () => {
  it('uses the current number when revised, else the blind one', () => {
    const before = livePricePct(
      [
        { participantId: 'a', blindPct: 75, currentPct: null },
        { participantId: 'b', blindPct: 75, currentPct: null },
      ],
      B,
      b,
    )
    const after = livePricePct(
      [
        { participantId: 'a', blindPct: 75, currentPct: 25 },
        { participantId: 'b', blindPct: 75, currentPct: null },
      ],
      B,
      b,
    )
    expect(before).toBeGreaterThan(50)
    expect(after).toBeCloseTo(50)
  })
})

describe('resolution', () => {
  const groups = [{ idx: 0, turnOrder: ['a', 'b', 'c'] }]
  const submissions = [
    { participantId: 'a', blindPct: 20, currentPct: null },
    { participantId: 'b', blindPct: 80, currentPct: 60 },
    { participantId: 'c', blindPct: 70, currentPct: 40 },
  ]

  it('scores a STEM question', () => {
    const r = computeResolution({ mode: 'stem', outcome: false, budget: B, b, submissions, groups })
    const a = r.perParticipant.get('a')!
    const b2 = r.perParticipant.get('b')!
    expect(a.finalPct).toBe(20)
    expect(b2.finalPct).toBe(60)
    expect(a.calibrationFinal).toBeCloseTo(96)
    expect(b2.calibrationBlind).toBeCloseTo(36)
    expect(b2.calibrationFinal).toBeCloseTo(64)
    expect(a.persuasion).toBeCloseTo(25)
    // Post price over finals 20, 60, 40: net = −60+20−20 = −60 → σ(−0.3) ≈ 42.6
    expect(r.postPricePct).toBeCloseTo(42.6, 0)
  })

  it('never scores humanities', () => {
    const r = computeResolution({ mode: 'humanities', outcome: null, budget: B, b, submissions, groups })
    for (const v of r.perParticipant.values()) {
      expect(v.calibrationFinal).toBeNull()
      expect(v.calibrationBlind).toBeNull()
      expect(v.persuasion).toBeNull()
    }
    expect(r.postPricePct).toBeCloseTo(42.6, 0)
  })
})
