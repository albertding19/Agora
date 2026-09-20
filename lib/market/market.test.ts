import { describe, expect, it } from 'vitest'
import { netPosition, position, stake } from './position'
import { liquidity, priceFromNet, pricePct, pricePctForClass, sigmoid } from './lmsr'

const B = 100
const K = 0.4

describe('position map', () => {
  it('is zero at 50 and antisymmetric', () => {
    expect(position(50, B)).toBe(0)
    for (const pct of [0, 5, 20, 35, 45, 60, 85, 100]) {
      expect(position(pct, B)).toBeCloseTo(-position(100 - pct, B), 10)
    }
  })

  it('stake equals B · 2|p − 0.5|', () => {
    expect(stake(75, B)).toBeCloseTo(50)
    expect(stake(25, B)).toBeCloseTo(50)
    expect(stake(100, B)).toBeCloseTo(100)
    expect(stake(50, B)).toBe(0)
  })

  it('net position sums positions', () => {
    expect(netPosition([75, 75, 25], B)).toBeCloseTo(50)
    expect(netPosition([], B)).toBe(0)
  })
})

describe('lmsr price', () => {
  it('sigmoid is stable at extremes', () => {
    expect(sigmoid(0)).toBe(0.5)
    expect(sigmoid(1000)).toBeCloseTo(1)
    expect(sigmoid(-1000)).toBeCloseTo(0)
    expect(Number.isNaN(sigmoid(1e6))).toBe(false)
  })

  it('prices 50 for an empty or symmetric class', () => {
    const b = liquidity(5, B, K)
    expect(pricePct([], B, b)).toBeCloseTo(50)
    expect(pricePct([90, 10], B, b)).toBeCloseTo(50)
    expect(pricePct([50, 50, 50], B, b)).toBeCloseTo(50)
  })

  it('liquidity clamps N to at least 3', () => {
    expect(liquidity(1, B, K)).toBe(liquidity(3, B, K))
    expect(liquidity(5, B, K)).toBeCloseTo(200)
  })

  it('matches the calibration numbers at k = 0.4', () => {
    // A class of 5 averaging 75% one way prices near 78%.
    expect(pricePctForClass([75, 75, 75, 75, 75], 5, B, K)).toBeCloseTo(77.7, 0)
    // Averaging 90% prices near 88%.
    expect(pricePctForClass([90, 90, 90, 90, 90], 5, B, K)).toBeCloseTo(88.1, 0)
    // One student moving 50 → 100 in a class of 5 moves the price about 12 points.
    const before = pricePctForClass([50, 50, 50, 50, 50], 5, B, K)
    const after = pricePctForClass([100, 50, 50, 50, 50], 5, B, K)
    expect(after - before).toBeCloseTo(12.2, 0)
    // Five unanimous 100% beliefs price near 92%, never 99.9.
    expect(pricePctForClass([100, 100, 100, 100, 100], 5, B, K)).toBeCloseTo(92.4, 0)
  })

  it('is invariant to class size for the same mean belief', () => {
    const small = pricePctForClass(Array(5).fill(75), 5, B, K)
    const large = pricePctForClass(Array(30).fill(75), 30, B, K)
    expect(large).toBeCloseTo(small, 6)
  })

  it('is monotone in each belief', () => {
    const b = liquidity(5, B, K)
    const base = [70, 40, 55, 90, 20]
    for (let i = 0; i < base.length; i++) {
      for (let step = 5; step <= 30; step += 5) {
        const up = [...base]
        up[i] = Math.min(100, base[i] + step)
        const down = [...base]
        down[i] = Math.max(0, base[i] - step)
        expect(pricePct(up, B, b)).toBeGreaterThanOrEqual(pricePct(base, B, b))
        expect(pricePct(down, B, b)).toBeLessThanOrEqual(pricePct(base, B, b))
      }
    }
  })

  it('is order independent', () => {
    const b = liquidity(6, B, K)
    const beliefs = [95, 5, 60, 40, 80, 20]
    const shuffled = [20, 80, 40, 60, 5, 95]
    expect(pricePct(beliefs, B, b)).toBeCloseTo(pricePct(shuffled, B, b), 12)
  })

  it('rejects non-positive liquidity', () => {
    expect(() => priceFromNet(10, 0)).toThrow()
    expect(() => liquidity(5, 0, K)).toThrow()
  })
})
