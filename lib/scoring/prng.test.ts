import { describe, expect, it } from 'vitest'
import { fnv1a32, mulberry32, seededShuffle } from './prng'

describe('fnv1a32', () => {
  it('returns the offset basis for the empty string', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5)
  })

  it('is stable for a pinned input', () => {
    // Reference FNV-1a 32-bit value for "a".
    expect(fnv1a32('a')).toBe(0xe40c292c)
    expect(fnv1a32('a')).toBe(fnv1a32('a'))
  })

  it('always yields an unsigned 32-bit integer', () => {
    for (const s of ['agora', 'question:abc', '\u{1F600}', 'x'.repeat(500)]) {
      const h = fnv1a32(s)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('mulberry32', () => {
  it('yields the same sequence from two fresh generators with the same seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const first = [a(), a(), a()]
    const second = [b(), b(), b()]
    expect(first).toEqual(second)
  })

  it('stays within [0, 1)', () => {
    const rnd = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const v = rnd()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })
})

describe('seededShuffle', () => {
  const items = Array.from({ length: 20 }, (_, i) => i)

  it('returns a permutation of the input without mutating it', () => {
    const snapshot = items.slice()
    const out = seededShuffle(items, mulberry32(42))
    expect(items).toEqual(snapshot)
    expect(out).toHaveLength(items.length)
    expect([...out].sort((x, y) => x - y)).toEqual(items)
  })

  it('is deterministic for the same seed', () => {
    const a = seededShuffle(items, mulberry32(42))
    const b = seededShuffle(items, mulberry32(42))
    expect(a).toEqual(b)
  })

  it('actually reorders for a typical seed', () => {
    expect(seededShuffle(items, mulberry32(42))).not.toEqual(items)
  })

  it('handles empty and singleton inputs', () => {
    expect(seededShuffle([], mulberry32(1))).toEqual([])
    expect(seededShuffle(['only'], mulberry32(1))).toEqual(['only'])
  })
})
