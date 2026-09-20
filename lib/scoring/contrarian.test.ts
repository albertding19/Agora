import { describe, expect, it } from 'vitest'
import { CONTRARIAN_MAX, CONTRARIAN_RATE, contrarianBonus } from './contrarian'

describe('contrarianBonus', () => {
  it('pins the constants', () => {
    expect(CONTRARIAN_RATE).toBe(0.5)
    expect(CONTRARIAN_MAX).toBe(25)
  })

  it('credits half the crowd error to a student who leaned right against a wrong crowd', () => {
    expect(contrarianBonus(20, 80, false)).toBe(15)
  })

  it('is 0 when the student leaned with the wrong crowd', () => {
    expect(contrarianBonus(80, 80, false)).toBe(0)
  })

  it('is 0 when the crowd was right', () => {
    expect(contrarianBonus(20, 30, false)).toBe(0)
  })

  it('is 0 when the crowd had no lean', () => {
    expect(contrarianBonus(20, 50, false)).toBe(0)
  })

  it('is 0 when the student had no lean', () => {
    expect(contrarianBonus(50, 80, false)).toBe(0)
  })

  it('is 0 when the student never submitted', () => {
    expect(contrarianBonus(null, 80, false)).toBe(0)
  })

  it('rounds to whole points', () => {
    expect(contrarianBonus(20, 78.1, false)).toBe(14)
    expect(contrarianBonus(95, 12.4, true)).toBe(19)
  })

  it('rounds an exact half up on both sides (abs is taken before rounding)', () => {
    expect(contrarianBonus(20, 79, false)).toBe(15)
    expect(contrarianBonus(80, 21, true)).toBe(15)
  })

  it('depends on the lean only, not on how confident the student was', () => {
    expect(contrarianBonus(5, 80, false)).toBe(contrarianBonus(45, 80, false))
    expect(contrarianBonus(45, 80, false)).toBe(15)
  })

  it('is 0 for a non-finite price or an undefined blind number', () => {
    expect(contrarianBonus(20, Number.NaN, false)).toBe(0)
    expect(contrarianBonus(undefined, 80, false)).toBe(0)
  })

  it('is symmetric between TRUE and FALSE', () => {
    expect(contrarianBonus(20, 80, false)).toBe(contrarianBonus(80, 20, true))
    expect(contrarianBonus(95, 12.4, true)).toBe(contrarianBonus(5, 87.6, false))
  })

  it('caps at CONTRARIAN_MAX', () => {
    expect(contrarianBonus(0, 100, false)).toBe(25)
    expect(contrarianBonus(100, 0, true)).toBe(25)
  })

  it('never goes negative or above the cap over the grid', () => {
    for (let blind = 0; blind <= 100; blind += 5) {
      for (let price = 0; price <= 100; price += 2.5) {
        for (const outcome of [true, false]) {
          const out = contrarianBonus(blind, price, outcome)
          expect(Number.isInteger(out)).toBe(true)
          expect(out).toBeGreaterThanOrEqual(0)
          expect(out).toBeLessThanOrEqual(CONTRARIAN_MAX)
        }
      }
    }
  })
})
