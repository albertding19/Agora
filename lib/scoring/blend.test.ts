import { describe, expect, it } from 'vitest'
import { blendPct } from './blend'

const STEPS = Array.from({ length: 21 }, (_, i) => i * 5)

describe('blendPct', () => {
  it('returns the mean when it is already a multiple of 5', () => {
    expect(blendPct(70, 40)).toBe(55)
    expect(blendPct(80, 80)).toBe(80)
  })

  it('rounds a halfway mean toward 50', () => {
    expect(blendPct(70, 45)).toBe(55)
    expect(blendPct(30, 55)).toBe(45)
    expect(blendPct(45, 50)).toBe(50)
    expect(blendPct(55, 50)).toBe(50)
  })

  it('stays inside [0, 100] at the extremes', () => {
    expect(blendPct(0, 5)).toBe(5)
    expect(blendPct(100, 95)).toBe(95)
  })

  it('returns the first number when there is no opposite', () => {
    expect(blendPct(60, null)).toBe(60)
    expect(blendPct(0, null)).toBe(0)
    expect(blendPct(100, null)).toBe(100)
  })

  it('treats an undefined or non-finite opposite as absent instead of producing NaN', () => {
    expect(blendPct(60, undefined)).toBe(60)
    expect(blendPct(60, Number.NaN)).toBe(60)
    expect(blendPct(60, Number.POSITIVE_INFINITY)).toBe(60)
  })

  it('is order-independent', () => {
    for (const a of STEPS) for (const b of STEPS) expect(blendPct(a, b)).toBe(blendPct(b, a))
  })

  it('is deterministic', () => {
    for (const a of STEPS) for (const b of STEPS) expect(blendPct(a, b)).toBe(blendPct(a, b))
  })

  it('over the full 21×21 grid: multiple of 5, within range, and mirror-symmetric', () => {
    for (const a of STEPS) {
      for (const b of STEPS) {
        const out = blendPct(a, b)
        expect(out % 5).toBe(0)
        expect(out).toBeGreaterThanOrEqual(Math.min(a, b))
        expect(out).toBeLessThanOrEqual(Math.max(a, b))
        expect(out).toBe(100 - blendPct(100 - a, 100 - b))
      }
    }
  })

  it('never leaves [min, max] even for off-step integers (the DB check is only 0–100)', () => {
    expect(blendPct(52, 53)).toBeGreaterThanOrEqual(52)
    expect(blendPct(52, 53)).toBeLessThanOrEqual(53)
    for (let a = 0; a <= 100; a += 1) {
      for (let b = 0; b <= 100; b += 1) {
        const out = blendPct(a, b)
        expect(Number.isFinite(out)).toBe(true)
        expect(out).toBeGreaterThanOrEqual(Math.min(a, b))
        expect(out).toBeLessThanOrEqual(Math.max(a, b))
      }
    }
  })
})
