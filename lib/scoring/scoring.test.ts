import { describe, expect, it } from 'vitest'
import { calibration, calibrationOrNull } from './calibration'
import { persuasionScores } from './persuasion'
import { rankLeaderboard } from './leaderboard'
import { histogram10 } from './histogram'
import { beliefMapReading } from './reading'

describe('calibration', () => {
  it('is 100 for a perfect number and 0 for a perfectly wrong one', () => {
    expect(calibration(100, true)).toBe(100)
    expect(calibration(0, false)).toBe(100)
    expect(calibration(0, true)).toBe(0)
    expect(calibration(100, false)).toBe(0)
  })
  it('is 75 at 50%', () => {
    expect(calibration(50, true)).toBeCloseTo(75)
    expect(calibration(50, false)).toBeCloseTo(75)
  })
  it('handles nulls', () => {
    expect(calibrationOrNull(null, true)).toBeNull()
    expect(calibrationOrNull(70, null)).toBeNull()
    expect(calibrationOrNull(70, true)).toBeCloseTo(91)
  })
})

describe('persuasion', () => {
  it('credits the correct-side member for movement toward truth', () => {
    // Answer FALSE. a was right (20), b and c were wrong and moved toward truth.
    const scores = persuasionScores(
      [
        { participantId: 'a', blindPct: 20, finalPct: 20 },
        { participantId: 'b', blindPct: 80, finalPct: 60 },
        { participantId: 'c', blindPct: 70, finalPct: 40 },
      ],
      false,
    )
    // a: others moved (80→60 = +20 toward FALSE, 70→40 = +30) → mean 25
    expect(scores.get('a')).toBeCloseTo(25)
    // b: others: a 0, c +30 → mean 15, but b was farther than mean distance → min(0, 15) = 0
    expect(scores.get('b')).toBeCloseTo(0)
    // c: others: a 0, b +20 → mean 10; c distance 70 vs mean distance (20+80+70)/3 = 56.7 → not credited → 0
    expect(scores.get('c')).toBeCloseTo(0)
  })

  it('penalises dragging the group the wrong way', () => {
    const scores = persuasionScores(
      [
        { participantId: 'a', blindPct: 90, finalPct: 90 },
        { participantId: 'b', blindPct: 40, finalPct: 70 },
      ],
      false,
    )
    // a: b moved 40→70, away from FALSE → −30; a not credited → min(0, −30) = −30
    expect(scores.get('a')).toBeCloseTo(-30)
    // b: a moved 0 → 0; b credited (closer than mean) → 0
    expect(scores.get('b')).toBeCloseTo(0)
  })

  it('still has a persuader in a unanimously wrong group', () => {
    // Answer FALSE, everyone was TRUE-leaning; the least wrong member pulled the others down.
    const scores = persuasionScores(
      [
        { participantId: 'a', blindPct: 80, finalPct: 60 },
        { participantId: 'b', blindPct: 75, finalPct: 55 },
        { participantId: 'c', blindPct: 65, finalPct: 65 },
      ],
      false,
    )
    expect(scores.get('c')).toBeCloseTo(20)
    expect(scores.get('a')).toBeCloseTo(0)
    expect(scores.get('b')).toBeCloseTo(0)
  })

  it('credits everyone when the group started identical and moved toward truth', () => {
    const scores = persuasionScores(
      [
        { participantId: 'a', blindPct: 75, finalPct: 55 },
        { participantId: 'b', blindPct: 75, finalPct: 55 },
        { participantId: 'c', blindPct: 75, finalPct: 55 },
      ],
      false,
    )
    expect(scores.get('a')).toBeCloseTo(20)
    expect(scores.get('b')).toBeCloseTo(20)
  })

  it('returns null for non-submitters and tiny groups', () => {
    const scores = persuasionScores(
      [
        { participantId: 'a', blindPct: 70, finalPct: 70 },
        { participantId: 'b', blindPct: null, finalPct: 40 },
      ],
      true,
    )
    expect(scores.get('a')).toBeNull()
    expect(scores.get('b')).toBeNull()
  })

  it('uses blind as final when a member never revised', () => {
    const scores = persuasionScores(
      [
        { participantId: 'a', blindPct: 90, finalPct: 90 },
        { participantId: 'b', blindPct: 30, finalPct: null },
      ],
      true,
    )
    expect(scores.get('a')).toBeCloseTo(0)
  })
})

describe('leaderboard', () => {
  it('ranks by calibration, then persuasion, nulls last', () => {
    const ranked = rankLeaderboard([
      { name: 'zed', calibration: null, persuasion: null },
      { name: 'amy', calibration: 90, persuasion: 5 },
      { name: 'bob', calibration: 90, persuasion: 20 },
      { name: 'cat', calibration: 95, persuasion: null },
    ])
    expect(ranked.map((r) => r.name)).toEqual(['cat', 'bob', 'amy', 'zed'])
  })
})

describe('histogram', () => {
  it('bins into ten buckets with 100 in the last', () => {
    const h = histogram10([0, 5, 10, 55, 95, 100, null])
    expect(h).toEqual([2, 1, 0, 0, 0, 1, 0, 0, 0, 2])
    expect(h.reduce((a, b) => a + b, 0)).toBe(6)
  })
})

describe('belief map reading', () => {
  it('names the shared misconception', () => {
    expect(beliefMapReading(85, null, false, 'stem')).toBe('Shared misconception.')
    expect(beliefMapReading(15, null, true, 'stem')).toBe('Shared misconception.')
  })
  it('says skip it when confident and right', () => {
    expect(beliefMapReading(85, null, true, 'stem')).toBe('Skip it.')
  })
  it('reads uncertainty near 50', () => {
    expect(beliefMapReading(52, null, true, 'stem')).toBe('Genuine uncertainty. Teach it.')
  })
  it('adds the movement verdict', () => {
    expect(beliefMapReading(85, 60, false, 'stem')).toBe('Shared misconception. The debate worked.')
    expect(beliefMapReading(85, 80, false, 'stem')).toBe("Shared misconception. The debate didn't.")
  })
  it('never resolves humanities', () => {
    expect(beliefMapReading(85, null, null, 'humanities')).toBe('Strong consensus. Check for groupthink.')
    expect(beliefMapReading(null, null, null, 'humanities')).toBeNull()
  })
})
