import { describe, expect, it } from 'vitest'
import { normalizeClusters, OTHER_LABEL } from '../clusterer'
import { FALLBACK_BAND, NEUTRAL_READING, normalizeProposal } from '../proposer'
import { cacheKey } from '../run'
import { BANNED_WORDS } from '@/lib/language'

describe('normalizeProposal', () => {
  it('widens a narrow band to at least 15 points', () => {
    const b = normalizeProposal({ stance: 'TRUE', lo: 70, hi: 80, reading: 'You sounded sure.' })!
    expect(b.hi - b.lo).toBeGreaterThanOrEqual(15)
    expect(b.lo).toBeLessThanOrEqual(70)
    expect(b.hi).toBeGreaterThanOrEqual(80)
  })

  it('widens a zero-width band symmetrically', () => {
    const b = normalizeProposal({ stance: 'TRUE', lo: 75, hi: 75, reading: 'x' })!
    expect(b.lo).toBe(65)
    expect(b.hi).toBe(80)
  })

  it('snaps to multiples of 5 and clamps to 0-100', () => {
    const b = normalizeProposal({ stance: 'TRUE', lo: 82, hi: 131, reading: 'x' })!
    expect(b.lo % 5).toBe(0)
    expect(b.hi).toBe(100)
    expect(b.lo).toBeLessThanOrEqual(85)
  })

  it('orders lo and hi', () => {
    const b = normalizeProposal({ stance: 'TRUE', lo: 90, hi: 60, reading: 'x' })!
    expect(b.lo).toBe(60)
    expect(b.hi).toBe(90)
  })

  it('forces 40-60 for UNCLEAR', () => {
    const b = normalizeProposal({ stance: 'UNCLEAR', lo: 10, hi: 20, reading: 'x' })!
    expect(b).toMatchObject({ stance: 'UNCLEAR', lo: 40, hi: 60 })
  })

  it('mirrors a FALSE stance whose band sits above 50', () => {
    const b = normalizeProposal({ stance: 'FALSE', lo: 70, hi: 90, reading: 'x' })!
    expect(b.stance).toBe('FALSE')
    expect(b.lo).toBe(10)
    expect(b.hi).toBe(30)
  })

  it('mirrors a TRUE stance whose band sits below 50', () => {
    const b = normalizeProposal({ stance: 'TRUE', lo: 10, hi: 30, reading: 'x' })!
    expect(b.lo).toBe(70)
    expect(b.hi).toBe(90)
  })

  it('truncates the reading to 140 characters', () => {
    const b = normalizeProposal({ stance: 'TRUE', lo: 60, hi: 80, reading: 'a'.repeat(300) })!
    expect(b.reading.length).toBe(140)
  })

  it('replaces a reading that breaks the language rule', () => {
    const b = normalizeProposal(
      { stance: 'TRUE', lo: 60, hi: 80, reading: `You would put your chips on this and the ${BANNED_WORDS[5]} look good.` },
    )!
    expect(b.reading).toBe(NEUTRAL_READING)
  })

  it('replaces an empty reading', () => {
    const b = normalizeProposal({ stance: 'TRUE', lo: 60, hi: 80, reading: '   ' })!
    expect(b.reading).toBe(NEUTRAL_READING)
  })

  it('returns null for an unusable shape', () => {
    expect(normalizeProposal({ stance: 'MAYBE', lo: 1, hi: 2, reading: 'x' })).toBeNull()
    expect(normalizeProposal(null)).toBeNull()
    expect(normalizeProposal({ stance: 'TRUE', lo: Number.NaN, hi: 2, reading: 'x' })).toBeNull()
  })

  it('fallback band is itself a valid band', () => {
    expect(normalizeProposal(FALLBACK_BAND)).toEqual(FALLBACK_BAND)
  })
})

describe('normalizeClusters', () => {
  const reasons = [0, 1, 2, 3, 4, 5].map((i) => ({ i, text: `reason ${i}` }))
  const cinput = { proposition: 'p', reasons }

  it('keeps well-formed clusters', () => {
    const out = normalizeClusters(
      { clusters: [{ label: 'A', members: [0, 1, 2] }, { label: 'B', members: [3, 4, 5] }] },
      cinput,
    )!
    expect(out.clusters).toHaveLength(2)
    expect(out.clusters[0]).toEqual({ label: 'A', members: [0, 1, 2] })
  })

  it('drops unknown and duplicate indices', () => {
    const out = normalizeClusters(
      { clusters: [{ label: 'A', members: [0, 1, 99, 1] }, { label: 'B', members: [1, 2, 3, 4, 5] }] },
      cinput,
    )!
    expect(out.clusters[0].members).toEqual([0, 1])
    expect(out.clusters[1].members).toEqual([2, 3, 4, 5])
  })

  it('puts unassigned indices into an Other cluster', () => {
    const out = normalizeClusters({ clusters: [{ label: 'A', members: [0, 1] }, { label: 'B', members: [2] }] }, cinput)!
    const other = out.clusters[out.clusters.length - 1]
    expect(other.label).toBe(OTHER_LABEL)
    expect(other.members).toEqual([3, 4, 5])
  })

  it('never exceeds four clusters, even with leftovers', () => {
    const out = normalizeClusters(
      {
        clusters: [
          { label: 'A', members: [0] },
          { label: 'B', members: [1] },
          { label: 'C', members: [2] },
          { label: 'D', members: [3] },
          { label: 'E', members: [4] },
        ],
      },
      cinput,
    )!
    expect(out.clusters.length).toBeLessThanOrEqual(4)
    const all = out.clusters.flatMap((c) => c.members).sort()
    expect(all).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('returns null when fewer than two clusters survive', () => {
    expect(normalizeClusters({ clusters: [{ label: 'A', members: [0, 1, 2, 3, 4, 5] }] }, cinput)).toBeNull()
    expect(normalizeClusters({ clusters: [] }, cinput)).toBeNull()
    expect(normalizeClusters({ nope: true }, cinput)).toBeNull()
  })

  it('truncates long labels and replaces ones that break the language rule', () => {
    const out = normalizeClusters(
      {
        clusters: [
          { label: 'x'.repeat(100), members: [0, 1, 2] },
          { label: `They would ${BANNED_WORDS[7]} on it`, members: [3, 4, 5] },
        ],
      },
      cinput,
    )!
    expect(out.clusters[0].label.length).toBe(60)
    expect(out.clusters[1].label).toBe('Argument 2')
  })
})

describe('cacheKey', () => {
  it('is stable across key order', () => {
    expect(cacheKey('a', 1, { x: 1, y: [1, 2] })).toBe(cacheKey('a', 1, { y: [1, 2], x: 1 }))
  })
  it('changes with version', () => {
    expect(cacheKey('a', 1, { x: 1 })).not.toBe(cacheKey('a', 2, { x: 1 }))
  })
})
