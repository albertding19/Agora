import { describe, expect, it } from 'vitest'
import { groupSizes, pairStudents, type PairingInput } from './pair'

function students(pcts: (number | null)[]): PairingInput[] {
  return pcts.map((blindPct, i) => ({ participantId: `p${String(i).padStart(2, '0')}`, blindPct }))
}

describe('groupSizes', () => {
  it('never makes a group of 2', () => {
    for (let n = 3; n <= 40; n++) {
      const sizes = groupSizes(n)
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n)
      for (const s of sizes) expect(s).toBeGreaterThanOrEqual(3)
      for (const s of sizes) expect(s).toBeLessThanOrEqual(5)
    }
  })
  it('handles the documented remainders', () => {
    expect(groupSizes(5)).toEqual([5])
    expect(groupSizes(4)).toEqual([4])
    expect(groupSizes(7)).toEqual([4, 3])
    expect(groupSizes(8)).toEqual([4, 4])
    expect(groupSizes(9)).toEqual([3, 3, 3])
    expect(groupSizes(2)).toEqual([2])
    expect(groupSizes(1)).toEqual([1])
    expect(groupSizes(0)).toEqual([])
  })
})

describe('pairStudents', () => {
  it('puts the most opposed students together', () => {
    const groups = pairStudents(students([10, 90, 50, 20, 80, 55]))
    expect(groups).toHaveLength(2)
    const ids = groups.map((g) => [...g.turnOrder].sort())
    // 10 (p00) pairs with the second-highest 80 (p04); 20 (p03) with the highest 90 (p01).
    expect(ids.some((g) => g.includes('p00') && g.includes('p04'))).toBe(true)
    expect(ids.some((g) => g.includes('p03') && g.includes('p01'))).toBe(true)
    for (const g of groups) expect(g.turnOrder).toHaveLength(3)
  })

  it('speaks least sure first and non-submitters last', () => {
    const [g] = pairStudents(students([90, null, 55, 30, 70]))
    expect(g.turnOrder).toHaveLength(5)
    // |55−50| = 5 first, then 30 (20), 70 (20) tie broken by id (p03 before p04), then 90, then null.
    expect(g.turnOrder).toEqual(['p02', 'p03', 'p04', 'p00', 'p01'])
  })

  it('is deterministic and covers everyone exactly once', () => {
    const input = students([5, 95, 45, 60, 35, 80, 15, 70, 50, 25, 90, 40, 65])
    const a = pairStudents(input)
    const b = pairStudents([...input].reverse())
    expect(a).toEqual(b)
    const all = a.flatMap((g) => g.turnOrder).sort()
    expect(all).toEqual(input.map((s) => s.participantId).sort())
  })

  it('makes one group for fewer than three students', () => {
    expect(pairStudents(students([70]))).toEqual([{ idx: 0, turnOrder: ['p00'] }])
    expect(pairStudents(students([70, 20]))[0].turnOrder).toHaveLength(2)
    expect(pairStudents([])).toEqual([])
  })
})
