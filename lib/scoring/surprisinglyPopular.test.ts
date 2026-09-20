import { describe, expect, it } from 'vitest'
import { MIN_SP_PREDICTIONS, lean, spInsight, surprisinglyPopular, type SpInput } from './surprisinglyPopular'

function rows(blind: (number | null)[], predictions: (number | null)[] = []): SpInput[] {
  return blind.map((ownPct, i) => ({ ownPct, predictedTruePct: predictions[i] ?? null }))
}

describe('lean', () => {
  it('is TRUE above 50, FALSE below, null at exactly 50', () => {
    expect(lean(55)).toBe(true)
    expect(lean(100)).toBe(true)
    expect(lean(45)).toBe(false)
    expect(lean(0)).toBe(false)
    expect(lean(50)).toBeNull()
  })
  it('is null for missing or non-finite numbers', () => {
    expect(lean(null)).toBeNull()
    expect(lean(undefined)).toBeNull()
    expect(lean(Number.NaN)).toBeNull()
    expect(lean(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('surprisinglyPopular', () => {
  it('finds FALSE surprisingly popular when fewer lean TRUE than the class predicted', () => {
    const out = surprisinglyPopular(rows([85, 80, 75, 70, 15, 10], [85, 90, 80, 85, 80, 85]))
    expect(out.actualTruePct).toBeCloseTo(66.67, 1)
    expect(out.predictedTruePct).toBeCloseTo(84.17, 1)
    expect(out.answer).toBe(false)
  })

  it('finds TRUE surprisingly popular when more lean TRUE than predicted', () => {
    const out = surprisinglyPopular(rows([80, 75, 70, 30, 20], [50, 55, 60, 40, 45]))
    expect(out.actualTruePct).toBeCloseTo(60)
    expect(out.predictedTruePct).toBeCloseTo(50)
    expect(out.answer).toBe(true)
  })

  it('has no prediction and no answer when nobody predicted', () => {
    const out = surprisinglyPopular(rows([80, 75, 70, 30, 20]))
    expect(out.actualTruePct).toBeCloseTo(60)
    expect(out.predictedTruePct).toBeNull()
    expect(out.answer).toBeNull()
  })

  it('needs at least MIN_SP_PREDICTIONS predictions', () => {
    expect(MIN_SP_PREDICTIONS).toBe(3)
    const two = surprisinglyPopular(rows([80, 75, 70, 30, 20], [50, 55]))
    expect(two.predictedTruePct).toBeNull()
    expect(two.answer).toBeNull()
    const three = surprisinglyPopular(rows([80, 75, 70, 30, 20], [50, 55, 60]))
    expect(three.predictedTruePct).toBeCloseTo(55)
    expect(three.answer).toBe(true)
  })

  it('has no actual and no answer when everyone sits at 50', () => {
    const out = surprisinglyPopular(rows([50, 50, 50, 50], [60, 60, 60, 60]))
    expect(out.actualTruePct).toBeNull()
    expect(out.predictedTruePct).toBeCloseTo(60)
    expect(out.answer).toBeNull()
  })

  it('excludes 50s and missing numbers from the leaner denominator', () => {
    const out = surprisinglyPopular(rows([80, 50, null, 20, 50], [70, 70, 70, null, null]))
    expect(out.actualTruePct).toBeCloseTo(50)
    expect(out.predictedTruePct).toBeCloseTo(70)
    expect(out.answer).toBe(false)
  })

  it('has no answer on a tie', () => {
    const out = surprisinglyPopular(rows([80, 75, 70, 30, 20], [60, 60, 60]))
    expect(out.actualTruePct).toBeCloseTo(60)
    expect(out.predictedTruePct).toBeCloseTo(60)
    expect(out.answer).toBeNull()
  })

  it('returns all nulls for an empty class', () => {
    expect(surprisinglyPopular([])).toEqual({ actualTruePct: null, predictedTruePct: null, answer: null })
  })

  it('skips undefined and non-finite predictions instead of counting them', () => {
    const out = surprisinglyPopular([
      { ownPct: 80, predictedTruePct: undefined },
      { ownPct: 20, predictedTruePct: Number.NaN },
      { ownPct: 70, predictedTruePct: 60 },
      { ownPct: 70, predictedTruePct: 60 },
      { ownPct: undefined, predictedTruePct: 60 },
    ])
    expect(out.actualTruePct).toBeCloseTo(75)
    expect(out.predictedTruePct).toBeCloseTo(60)
    expect(out.answer).toBe(true)
  })

  it('detects a tie exactly when actual and predicted are the same fraction', () => {
    const out = surprisinglyPopular(rows([80, 80, 20], [65, 70, 65]))
    expect(out.actualTruePct).toBeCloseTo(200 / 3)
    expect(out.predictedTruePct).toBeCloseTo(200 / 3)
    expect(out.answer).toBeNull()
  })

  it('is order-independent and deterministic for a 30-student class', () => {
    const input = Array.from({ length: 30 }, (_, i) => ({
      ownPct: i % 7 === 0 ? 50 : i < 17 ? 80 : 20,
      predictedTruePct: i % 5 === 0 ? null : 55 + (i % 3) * 5,
    }))
    const forward = surprisinglyPopular(input)
    const reversed = surprisinglyPopular([...input].reverse())
    const rotated = surprisinglyPopular([...input.slice(11), ...input.slice(0, 11)])
    expect(forward).toEqual(reversed)
    expect(forward).toEqual(rotated)
    expect(surprisinglyPopular(input)).toEqual(forward)
    expect(forward.actualTruePct).toBeCloseTo((100 * 14) / 25)
    expect(forward.answer).toBe(false)
  })
})

describe('spInsight', () => {
  it('is true when the student was right and expected the class to disagree', () => {
    expect(spInsight(20, 70, false)).toBe(true)
  })
  it('is false when the student was right but expected the class to agree', () => {
    expect(spInsight(20, 30, false)).toBe(false)
  })
  it('is false when the student was wrong', () => {
    expect(spInsight(80, 30, false)).toBe(false)
  })
  it('is null when the prediction has no lean', () => {
    expect(spInsight(20, 50, false)).toBeNull()
  })
  it('is null when the student has no lean', () => {
    expect(spInsight(50, 70, false)).toBeNull()
  })
  it('is null when the student never submitted', () => {
    expect(spInsight(null, 70, false)).toBeNull()
  })
  it('is null when there is no reference', () => {
    expect(spInsight(20, 70, null)).toBeNull()
  })
  it('is null for undefined inputs', () => {
    expect(spInsight(undefined, 70, false)).toBeNull()
    expect(spInsight(20, undefined, false)).toBeNull()
  })
  it('mirrors for the TRUE side', () => {
    expect(spInsight(80, 30, true)).toBe(true)
    expect(spInsight(80, 70, true)).toBe(false)
  })
})
