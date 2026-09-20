import { describe, expect, it } from 'vitest'
import { bradleyTerry, winPct, type Comparison } from './bradleyTerry'
import { mulberry32 } from './prng'

function strengthsOf(map: Map<string, number>, ...ids: string[]): number[] {
  return ids.map((id) => {
    const v = map.get(id)
    if (v === undefined) throw new Error(`missing strength for ${id}`)
    return v
  })
}

/** A seeded class: `n` arguments, `m` comparisons drawn from latent strengths. */
function seededClass(seed: number, n: number, m: number): { items: string[]; comparisons: Comparison[] } {
  const rnd = mulberry32(seed)
  const items = Array.from({ length: n }, (_, i) => `arg${i}`)
  const latent = items.map(() => Math.exp((rnd() - 0.5) * 4))
  const comparisons: Comparison[] = []
  while (comparisons.length < m) {
    const i = Math.floor(rnd() * n)
    const j = Math.floor(rnd() * n)
    if (i === j) continue
    const pi = latent[i] / (latent[i] + latent[j])
    comparisons.push(rnd() < pi ? { winner: items[i], loser: items[j] } : { winner: items[j], loser: items[i] })
  }
  return { items, comparisons }
}

const CHAIN: Comparison[] = [
  { winner: 'a', loser: 'b' },
  { winner: 'b', loser: 'c' },
]

describe('bradleyTerry', () => {
  it('ranks a chain a>b, b>c as a > b > c', () => {
    const out = bradleyTerry(['a', 'b', 'c'], CHAIN)
    const [a, b, c] = strengthsOf(out, 'a', 'b', 'c')
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(c)
  })

  it('gives equal strengths of exactly 1 for a 1-1 split', () => {
    const out = bradleyTerry(
      ['a', 'b'],
      [
        { winner: 'a', loser: 'b' },
        { winner: 'b', loser: 'a' },
      ],
    )
    const [a, b] = strengthsOf(out, 'a', 'b')
    expect(Math.abs(a - 1)).toBeLessThan(1e-6)
    expect(Math.abs(b - 1)).toBeLessThan(1e-6)
  })

  it('stays finite for a single comparison and orders the winner first', () => {
    const out = bradleyTerry(['a', 'b'], [{ winner: 'a', loser: 'b' }])
    const [a, b] = strengthsOf(out, 'a', 'b')
    expect(Number.isFinite(a)).toBe(true)
    expect(Number.isFinite(b)).toBe(true)
    expect(a).toBeGreaterThan(b)
    // The fit is symmetric under swapping the two labels, so a * b = 1.
    expect(a * b).toBeCloseTo(1, 5)
  })

  it('returns exactly 1 for every item when there are no comparisons', () => {
    const out = bradleyTerry(['a', 'b', 'c'], [])
    expect(out.size).toBe(3)
    for (const v of out.values()) expect(v).toBe(1)
  })

  it('leaves an item with no comparisons at exactly 1 while others move', () => {
    const out = bradleyTerry(['a', 'b', 'lonely'], [{ winner: 'a', loser: 'b' }])
    expect(out.get('lonely')).toBe(1)
    expect(out.get('a')).not.toBe(1)
  })

  it('keeps every strength positive, even for an item that never wins', () => {
    const comparisons: Comparison[] = []
    for (let k = 0; k < 20; k++) {
      comparisons.push({ winner: 'a', loser: 'b' })
      comparisons.push({ winner: 'a', loser: 'c' })
      comparisons.push({ winner: 'b', loser: 'c' })
    }
    const out = bradleyTerry(['a', 'b', 'c'], comparisons)
    for (const v of out.values()) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThan(0)
    }
    const [a, b, c] = strengthsOf(out, 'a', 'b', 'c')
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(c)
  })

  it('ignores comparisons naming ids outside items and self-comparisons', () => {
    const out = bradleyTerry(
      ['a', 'b'],
      [
        { winner: 'a', loser: 'ghost' },
        { winner: 'ghost', loser: 'b' },
        { winner: 'a', loser: 'a' },
      ],
    )
    expect(out.size).toBe(2)
    expect(out.get('a')).toBe(1)
    expect(out.get('b')).toBe(1)
    expect(out.has('ghost')).toBe(false)
  })

  it('is symmetric under relabelling', () => {
    const forward = bradleyTerry(
      ['x', 'y', 'z'],
      [
        { winner: 'x', loser: 'y' },
        { winner: 'y', loser: 'z' },
      ],
    )
    const mirrored = bradleyTerry(
      ['z', 'y', 'x'],
      [
        { winner: 'z', loser: 'y' },
        { winner: 'y', loser: 'x' },
      ],
    )
    expect(forward.get('x')).toBeCloseTo(mirrored.get('z') as number, 9)
    expect(forward.get('z')).toBeCloseTo(mirrored.get('x') as number, 9)
  })

  it('performs exactly the Jacobi sweep of the plan formula', () => {
    // Chain a>b, b>c, prior 0.5, all strengths start at 1.
    // Sweep 1: a = 1.5 / (1/2 + 1/2) = 1.5; b = 1.5 / (1/2 + 1/2 + 1/2) = 1; c = 0.5 / (1/2 + 1/2) = 0.5.
    // A Gauss-Seidel sweep would already use a = 1.5 for b and give 1.5 / 1.4 instead.
    const one = bradleyTerry(['a', 'b', 'c'], CHAIN, 1)
    expect(one.get('a')).toBeCloseTo(1.5, 12)
    expect(one.get('b')).toBeCloseTo(1, 12)
    expect(one.get('c')).toBeCloseTo(0.5, 12)
    // Sweep 2 from (1.5, 1, 0.5):
    // a = 1.5 / (1/2.5 + 1/2.5) = 1.875
    // b = 1.5 / (1/2.5 + 1/1.5 + 1/2) = 1.5 / (0.4 + 0.6667 + 0.5) = 0.957447
    // c = 0.5 / (1/1.5 + 1/1.5) = 0.375
    const two = bradleyTerry(['a', 'b', 'c'], CHAIN, 2)
    expect(two.get('a')).toBeCloseTo(1.875, 12)
    expect(two.get('b')).toBeCloseTo(1.5 / (0.4 + 2 / 3 + 0.5), 12)
    expect(two.get('c')).toBeCloseTo(0.375, 12)
  })

  it('reaches the analytic fixed point of the chain a>b, b>c with the default budget', () => {
    // With prior 0.5 the middle item sits at 1 by symmetry, and the outer
    // ones solve 1.5 = 2x/(x+1) and 0.5 = 2y/(y+1): x = 3, y = 1/3.
    // Check: a = 1.5 / (1/4 + 1/4) = 3; b = 1.5 / (1/4 + 3/4 + 1/2) = 1; c = 0.5 / (3/4 + 3/4) = 1/3.
    const out = bradleyTerry(['a', 'b', 'c'], CHAIN)
    expect(out.get('a')).toBeCloseTo(3, 5)
    expect(out.get('b')).toBeCloseTo(1, 5)
    expect(out.get('c')).toBeCloseTo(1 / 3, 5)
  })

  it('converges on a 30-student class with the default budget', () => {
    // 30 arguments, 90 comparisons (three per student): the default must
    // reach the same fixed point as an effectively unbounded run, and the
    // top three the teacher sees must match. 50 sweeps did neither.
    for (const seed of [1, 2, 3, 4, 5]) {
      const { items, comparisons } = seededClass(seed, 30, 90)
      const fitted = bradleyTerry(items, comparisons)
      const reference = bradleyTerry(items, comparisons, 100000)
      const rank = (m: Map<string, number>) =>
        [...items].sort((x, y) => (m.get(y) as number) - (m.get(x) as number))
      expect(rank(fitted).slice(0, 3)).toEqual(rank(reference).slice(0, 3))
      for (const id of items) {
        expect(fitted.get(id)).toBeCloseTo(reference.get(id) as number, 5)
      }
    }
  })

  it('honours an explicit iteration cap and treats 0 as no sweeps', () => {
    const none = bradleyTerry(['a', 'b', 'c'], CHAIN, 0)
    for (const v of none.values()) expect(v).toBe(1)
    const capped = bradleyTerry(['a', 'b', 'c'], CHAIN, 5)
    expect(capped.get('a')).toBeLessThan(2.99)
    expect(capped.get('a')).toBeGreaterThan(1.875)
  })

  it('stops early once the sweep-to-sweep change is below tolerance', () => {
    // A long budget must still return the same fixed point as an even longer one.
    const comparisons: Comparison[] = [
      { winner: 'a', loser: 'b' },
      { winner: 'a', loser: 'c' },
      { winner: 'b', loser: 'c' },
    ]
    const a = bradleyTerry(['a', 'b', 'c'], comparisons, 2000)
    const b = bradleyTerry(['a', 'b', 'c'], comparisons, 20000)
    for (const id of ['a', 'b', 'c']) expect(a.get(id)).toBeCloseTo(b.get(id) as number, 9)
  })

  it('normalizes garbage parameters instead of throwing', () => {
    const reference = bradleyTerry(['a', 'b', 'c'], CHAIN)
    for (const prior of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = bradleyTerry(['a', 'b', 'c'], CHAIN, undefined, prior)
      for (const id of ['a', 'b', 'c']) expect(out.get(id)).toBeCloseTo(reference.get(id) as number, 9)
    }
    for (const iterations of [Number.NaN, Number.POSITIVE_INFINITY, -3]) {
      const out = bradleyTerry(['a', 'b', 'c'], CHAIN, iterations)
      for (const v of out.values()) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThan(0)
      }
    }
    expect(bradleyTerry([], []).size).toBe(0)
    expect(bradleyTerry([], CHAIN).size).toBe(0)
    const dup = bradleyTerry(['a', 'a', 'b'], [{ winner: 'a', loser: 'b' }])
    expect(dup.size).toBe(2)
    expect(dup.get('a')).toBeGreaterThan(dup.get('b') as number)
    const holes = bradleyTerry(
      ['a', 'b'],
      [null, undefined, {}, { winner: 'a' }, { loser: 'b' }] as unknown as Comparison[],
    )
    expect(holes.get('a')).toBe(1)
    expect(holes.get('b')).toBe(1)
  })

  it('is deterministic', () => {
    const { items, comparisons } = seededClass(9, 12, 36)
    expect(bradleyTerry(items, comparisons)).toEqual(bradleyTerry(items, comparisons))
  })
})

describe('winPct', () => {
  it('is 50 at the reference strength', () => {
    expect(winPct(1)).toBe(50)
  })

  it('rises with strength and stays within [0, 100]', () => {
    expect(winPct(3)).toBe(75)
    expect(winPct(1 / 3)).toBe(25)
    expect(winPct(0)).toBe(0)
    expect(winPct(1e9)).toBeLessThanOrEqual(100)
    expect(winPct(1e9)).toBeGreaterThan(99)
  })

  it('rounds to one decimal', () => {
    expect(winPct(2)).toBe(66.7)
    expect(winPct(0.5)).toBe(33.3)
  })

  it('clamps garbage to the ends of the range', () => {
    expect(winPct(Number.NaN)).toBe(0)
    expect(winPct(-1)).toBe(0)
    expect(winPct(Number.NEGATIVE_INFINITY)).toBe(0)
    expect(winPct(Number.POSITIVE_INFINITY)).toBe(100)
  })
})
