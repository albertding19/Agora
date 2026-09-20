import { describe, expect, it } from 'vitest'
import { steelmanSideFor } from './steelman'

describe('steelmanSideFor', () => {
  it('asks a TRUE-leaning student to argue FALSE', () => {
    expect(steelmanSideFor(80)).toBe('FALSE')
    expect(steelmanSideFor(55)).toBe('FALSE')
    expect(steelmanSideFor(100)).toBe('FALSE')
  })
  it('asks a FALSE-leaning student to argue TRUE', () => {
    expect(steelmanSideFor(20)).toBe('TRUE')
    expect(steelmanSideFor(45)).toBe('TRUE')
    expect(steelmanSideFor(0)).toBe('TRUE')
  })
  it('lets a student at exactly 50 pick a side', () => {
    expect(steelmanSideFor(50)).toBe('EITHER')
  })
  it('lets a student with no number pick a side', () => {
    expect(steelmanSideFor(null)).toBe('EITHER')
    expect(steelmanSideFor(undefined)).toBe('EITHER')
    expect(steelmanSideFor(Number.NaN)).toBe('EITHER')
  })
  it('agrees with the lean rule on every step-5 number', () => {
    for (let pct = 0; pct <= 100; pct += 5) {
      const side = steelmanSideFor(pct)
      expect(side).toBe(pct > 50 ? 'FALSE' : pct < 50 ? 'TRUE' : 'EITHER')
    }
  })
})
