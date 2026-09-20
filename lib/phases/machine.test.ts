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
  transitionTarget,
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

  it('lands an open question on resolved straight after the snapshot', () => {
    expect(transitionTarget('snapshot', 'open')).toBe('resolved')
    expect(transitionTarget('snapshot', 'stem')).toBe('structured')
    expect(transitionTarget('snapshot', 'humanities')).toBe('structured')
    expect(transitionTarget('blind', 'open')).toBe('snapshot')
    expect(transitionTarget('resolved', 'open')).toBeNull()
    expect(transitionTarget('resolved', 'stem')).toBeNull()
    expect(transitionTarget('resolved', 'humanities')).toBeNull()
  })

  it('auto-advances an open question only out of blind', () => {
    const past = new Date('2026-09-20T09:00:00Z').toISOString()
    const now = new Date('2026-09-20T10:00:00Z')
    expect(autoAdvanceTarget({ phase: 'blind', mode: 'open', correctAnswer: null, phaseEndsAt: past }, now)).toBe('snapshot')
    expect(autoAdvanceTarget({ phase: 'snapshot', mode: 'open', correctAnswer: null, phaseEndsAt: past }, now)).toBeNull()
    expect(autoAdvanceTarget({ phase: 'snapshot', mode: 'open', correctAnswer: null, phaseEndsAt: null }, now)).toBeNull()
    // Never reached for an open question, but a stray timer must not move it.
    expect(autoAdvanceTarget({ phase: 'structured', mode: 'open', correctAnswer: null, phaseEndsAt: past }, now)).toBeNull()
    expect(autoAdvanceTarget({ phase: 'open', mode: 'open', correctAnswer: null, phaseEndsAt: past }, now)).toBeNull()
    expect(autoAdvanceTarget({ phase: 'blind', mode: 'open', correctAnswer: null, phaseEndsAt: null }, now)).toBeNull()
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
    // Nobody predicted the class, so there is no surprisingly popular answer.
    expect(result.surprisinglyPopular.actualTruePct).toBeCloseTo(100)
    expect(result.surprisinglyPopular.predictedTruePct).toBeNull()
    expect(result.surprisinglyPopular.answer).toBeNull()
  })

  it('finds the surprisingly popular answer from the class predictions', () => {
    const result = computeSnapshot({
      participantIds: ['a', 'b', 'c', 'd', 'e'],
      submissions: [
        { participantId: 'a', blindPct: 75, currentPct: null, predictedTruePct: 80 },
        { participantId: 'b', blindPct: 80, currentPct: null, predictedTruePct: 85 },
        { participantId: 'c', blindPct: 70, currentPct: null, predictedTruePct: 80 },
        { participantId: 'd', blindPct: 75, currentPct: null, predictedTruePct: 85 },
      ],
      budget: B,
      b,
    })
    // Everyone leaned TRUE (100%) while the class expected 82.5% to: TRUE is surprisingly popular.
    expect(result.blindPricePct).toBeCloseTo(73.1, 0)
    expect(result.surprisinglyPopular.actualTruePct).toBeCloseTo(100)
    expect(result.surprisinglyPopular.predictedTruePct).toBeCloseTo(82.5)
    expect(result.surprisinglyPopular.answer).toBe(true)
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
    { participantId: 'a', blindPct: 20, currentPct: null, predictedTruePct: 70 },
    { participantId: 'b', blindPct: 80, currentPct: 60, predictedTruePct: 70 },
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

  it('marks who knew something the crowd did not', () => {
    const r = computeResolution({ mode: 'stem', outcome: false, budget: B, b, submissions, groups })
    // a leaned FALSE (right) while expecting 70% of the class to say TRUE.
    expect(r.perParticipant.get('a')!.spInsight).toBe(true)
    // b leaned TRUE: wrong, so no insight even though the prediction matched.
    expect(r.perParticipant.get('b')!.spInsight).toBe(false)
    // c never predicted the class.
    expect(r.perParticipant.get('c')!.spInsight).toBeNull()
  })

  it('credits a right contrarian with half the crowd error', () => {
    const r = computeResolution({ mode: 'stem', outcome: false, budget: B, b, submissions, groups })
    // Blind net = −60+60+40 = 40 → blind price σ(0.2) ≈ 54.98: the crowd leaned TRUE and was wrong.
    // a leaned FALSE: round(0.5 · 4.98) = 2. b and c leaned with the crowd.
    expect(r.perParticipant.get('a')!.contrarianBonus).toBe(2)
    expect(r.perParticipant.get('b')!.contrarianBonus).toBe(0)
    expect(r.perParticipant.get('c')!.contrarianBonus).toBe(0)
  })

  it('gives no contrarian credit and no insight when the crowd was right', () => {
    const r = computeResolution({ mode: 'stem', outcome: true, budget: B, b, submissions, groups })
    expect(r.perParticipant.get('a')!.contrarianBonus).toBe(0)
    expect(r.perParticipant.get('b')!.contrarianBonus).toBe(0)
    expect(r.perParticipant.get('a')!.spInsight).toBe(false)
    expect(r.perParticipant.get('b')!.spInsight).toBe(false)
  })

  it('never scores humanities', () => {
    const r = computeResolution({ mode: 'humanities', outcome: null, budget: B, b, submissions, groups })
    for (const v of r.perParticipant.values()) {
      expect(v.calibrationFinal).toBeNull()
      expect(v.calibrationBlind).toBeNull()
      expect(v.persuasion).toBeNull()
      expect(v.contrarianBonus).toBeNull()
      // Only two predictions: no surprisingly popular answer to measure insight against.
      expect(v.spInsight).toBeNull()
    }
    expect(r.postPricePct).toBeCloseTo(42.6, 0)
  })

  it('uses the surprisingly popular answer as the humanities reference', () => {
    const r = computeResolution({
      mode: 'humanities',
      outcome: null,
      budget: B,
      b,
      submissions: [
        { participantId: 'a', blindPct: 20, currentPct: null, predictedTruePct: 70 },
        { participantId: 'b', blindPct: 80, currentPct: 60, predictedTruePct: 70 },
        { participantId: 'c', blindPct: 70, currentPct: 40, predictedTruePct: 90 },
      ],
      groups,
    })
    // 66.7% leaned TRUE vs 76.7% expected: FALSE is surprisingly popular; a leaned FALSE and expected a TRUE majority.
    expect(r.perParticipant.get('a')!.spInsight).toBe(true)
    expect(r.perParticipant.get('b')!.spInsight).toBe(false)
    expect(r.perParticipant.get('c')!.spInsight).toBe(false)
    expect(r.perParticipant.get('a')!.contrarianBonus).toBeNull()
  })
})
