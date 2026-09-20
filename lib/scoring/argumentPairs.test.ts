import { describe, expect, it } from 'vitest'
import { selectArgumentPairs, type ArgumentCandidate } from './argumentPairs'

const Q = 'q-1'

function candidate(
  n: number,
  blindPct: number | null,
  overrides: Partial<ArgumentCandidate> = {},
): ArgumentCandidate {
  return {
    submissionId: `s${n}`,
    participantId: `p${n}`,
    text: `argument ${n}`,
    blindPct,
    ...overrides,
  }
}

/** Six candidates, three leaning TRUE and three FALSE, none belonging to the voter. */
function sixCandidates(): ArgumentCandidate[] {
  return [
    candidate(1, 80),
    candidate(2, 20),
    candidate(3, 90),
    candidate(4, 10),
    candidate(5, 70),
    candidate(6, 30),
  ]
}

/** A class of thirty: 18 leaning TRUE, 9 FALSE, 3 undecided at exactly 50. */
function thirtyCandidates(): ArgumentCandidate[] {
  return Array.from({ length: 30 }, (_, i) =>
    candidate(i + 1, i % 10 === 9 ? 50 : i % 3 === 0 ? 20 : 80),
  )
}

type Pair = ReturnType<typeof selectArgumentPairs>[number]

function idsIn(pairs: readonly Pair[]): string[] {
  return pairs.flatMap((p) => [p.a.id, p.b.id])
}

function keyOf(p: Pair): string {
  return [p.a.id, p.b.id].sort().join('|')
}

function sideFor(candidates: readonly ArgumentCandidate[]): Map<string, 'TRUE' | 'FALSE' | null> {
  const m = new Map<string, 'TRUE' | 'FALSE' | null>()
  for (const c of candidates) {
    m.set(c.submissionId, c.blindPct === null ? null : c.blindPct > 50 ? 'TRUE' : c.blindPct < 50 ? 'FALSE' : null)
  }
  return m
}

function isOpposite(p: Pair, side: Map<string, 'TRUE' | 'FALSE' | null>): boolean {
  const x = side.get(p.a.id)
  const y = side.get(p.b.id)
  return x !== null && y !== null && x !== y
}

describe('selectArgumentPairs', () => {
  it("excludes the voter's own text", () => {
    const candidates = [...sixCandidates(), candidate(7, 60, { participantId: 'voter' })]
    const pairs = selectArgumentPairs({
      questionId: Q,
      voterId: 'voter',
      candidates,
      alreadyCompared: [],
    })
    expect(pairs.length).toBeGreaterThan(0)
    expect(idsIn(pairs)).not.toContain('s7')
  })

  it('returns at most three pairs by default', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => candidate(i + 1, i % 2 ? 80 : 20))
    const pairs = selectArgumentPairs({
      questionId: Q,
      voterId: 'voter',
      candidates,
      alreadyCompared: [],
    })
    expect(pairs).toHaveLength(3)
  })

  it('honours maxPairs and normalizes garbage values', () => {
    const base = { questionId: Q, voterId: 'voter', candidates: sixCandidates(), alreadyCompared: [] }
    expect(selectArgumentPairs({ ...base, maxPairs: 1 })).toHaveLength(1)
    expect(selectArgumentPairs({ ...base, maxPairs: 0 })).toHaveLength(0)
    expect(selectArgumentPairs({ ...base, maxPairs: -2 })).toHaveLength(0)
    expect(selectArgumentPairs({ ...base, maxPairs: 2.9 })).toHaveLength(2)
    expect(selectArgumentPairs({ ...base, maxPairs: 10 }).length).toBeGreaterThan(3)
    expect(selectArgumentPairs({ ...base, maxPairs: Number.NaN })).toHaveLength(3)
    // Six candidates make C(6, 2) = 15 unordered pairs.
    expect(selectArgumentPairs({ ...base, maxPairs: Number.POSITIVE_INFINITY })).toHaveLength(15)
  })

  it('is deterministic for the same voter and question', () => {
    const base = { questionId: Q, voterId: 'voter', candidates: sixCandidates(), alreadyCompared: [] }
    expect(selectArgumentPairs(base)).toEqual(selectArgumentPairs(base))
  })

  it('does not depend on the order candidates are supplied in', () => {
    const forward = selectArgumentPairs({
      questionId: Q,
      voterId: 'voter',
      candidates: sixCandidates(),
      alreadyCompared: [],
    })
    const reversed = selectArgumentPairs({
      questionId: Q,
      voterId: 'voter',
      candidates: sixCandidates().reverse(),
      alreadyCompared: [],
    })
    expect(reversed).toEqual(forward)
  })

  it('gives a different voter a different order', () => {
    const outputs = new Set<string>()
    for (const voterId of ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']) {
      outputs.add(
        JSON.stringify(
          selectArgumentPairs({
            questionId: Q,
            voterId,
            candidates: sixCandidates(),
            alreadyCompared: [],
          }),
        ),
      )
    }
    expect(outputs.size).toBeGreaterThan(1)
  })

  it('gives the same voter a different order on a different question', () => {
    const one = selectArgumentPairs({ questionId: 'q-1', voterId: 'v', candidates: thirtyCandidates(), alreadyCompared: [] })
    const two = selectArgumentPairs({ questionId: 'q-2', voterId: 'v', candidates: thirtyCandidates(), alreadyCompared: [] })
    expect(one).not.toEqual(two)
  })

  it('skips pairs the voter has already compared, in either orientation', () => {
    const candidates = [candidate(1, 80), candidate(2, 20), candidate(3, 50)]
    const forward = selectArgumentPairs({
      questionId: Q,
      voterId: 'voter',
      candidates,
      alreadyCompared: [{ a: 's1', b: 's2' }],
    })
    const backward = selectArgumentPairs({
      questionId: Q,
      voterId: 'voter',
      candidates,
      alreadyCompared: [{ a: 's2', b: 's1' }],
    })
    for (const pairs of [forward, backward]) {
      expect(pairs).toHaveLength(2)
      for (const p of pairs) expect(keyOf(p)).not.toBe('s1|s2')
    }
  })

  it('returns nothing once every pair has been compared', () => {
    const candidates = [candidate(1, 80), candidate(2, 20), candidate(3, 50)]
    const pairs = selectArgumentPairs({
      questionId: Q,
      voterId: 'voter',
      candidates,
      alreadyCompared: [
        { a: 's1', b: 's2' },
        { a: 's2', b: 's3' },
        { a: 's3', b: 's1' },
      ],
    })
    expect(pairs).toEqual([])
  })

  it('after a vote, the next poll starts with the pair the phone advanced to, same orientation', () => {
    // The UI advances optimistically to pairs[1] after voting on pairs[0];
    // the fresh view must agree with it, so a vote never moves a pair or
    // swaps its buttons under a thumb. Walk every voter through the whole
    // sequence of a 30-student class.
    const candidates = thirtyCandidates()
    for (const voterId of ['v1', 'v2', 'v3', 'v4', 'v5']) {
      const compared: { a: string; b: string }[] = []
      let previous = selectArgumentPairs({ questionId: Q, voterId, candidates, alreadyCompared: compared })
      let votes = 0
      while (previous.length > 0) {
        const voted = previous[0]
        compared.push({ a: voted.a.id, b: voted.b.id })
        const next = selectArgumentPairs({ questionId: Q, voterId, candidates, alreadyCompared: compared })
        expect(next.slice(0, previous.length - 1)).toEqual(previous.slice(1))
        previous = next
        votes++
      }
      // Every unordered pair of the class was offered exactly once: C(30, 2).
      expect(votes).toBe(435)
      expect(new Set(compared.map((c) => [c.a, c.b].sort().join('|'))).size).toBe(435)
    }
  })

  it('prefers opposite blind leans when available', () => {
    const side = sideFor(sixCandidates())
    for (const voterId of ['v1', 'v2', 'v3', 'v4']) {
      const pairs = selectArgumentPairs({
        questionId: Q,
        voterId,
        candidates: sixCandidates(),
        alreadyCompared: [],
      })
      expect(pairs).toHaveLength(3)
      for (const p of pairs) expect(isOpposite(p, side)).toBe(true)
    }
  })

  it('offers every opposite-lean pair before any same-side pair, even after many votes', () => {
    const candidates = thirtyCandidates()
    const side = sideFor(candidates)
    const all = selectArgumentPairs({
      questionId: Q,
      voterId: 'voter',
      candidates,
      alreadyCompared: [],
      maxPairs: Number.POSITIVE_INFINITY,
    })
    expect(all).toHaveLength(435)
    // Pass 1 shows each of the 30 arguments once (15 pairs) and gets the
    // most opposite-lean pairs a one-to-one matching allows: min(18, 9) = 9.
    const pass1 = all.slice(0, 15)
    expect(pass1.filter((p) => isOpposite(p, side))).toHaveLength(9)
    expect(new Set(idsIn(pass1)).size).toBe(30)
    // Pass 2 then offers the other 18 x 9 - 9 = 153 opposite-lean pairs
    // before any of the remaining same-side or neutral pairs.
    const rest = all.slice(15)
    expect(rest.slice(0, 153).every((p) => isOpposite(p, side))).toBe(true)
    expect(rest.slice(153).some((p) => isOpposite(p, side))).toBe(false)
    expect(all.filter((p) => isOpposite(p, side))).toHaveLength(162)
  })

  it('treats exactly 50 and a missing blind number as neutral, never as an opposite lean', () => {
    const candidates = [candidate(1, 50), candidate(2, 50), candidate(3, null), candidate(4, 80)]
    const pairs = selectArgumentPairs({ questionId: Q, voterId: 'voter', candidates, alreadyCompared: [] })
    expect(pairs).toHaveLength(3)
    expect(new Set(pairs.map(keyOf)).size).toBe(3)
  })

  it('falls back to same-side pairs when no opposite lean is left', () => {
    const pairs = selectArgumentPairs({
      questionId: Q,
      voterId: 'voter',
      candidates: [candidate(1, 80), candidate(2, 90), candidate(3, null)],
      alreadyCompared: [],
    })
    expect(pairs).toHaveLength(3)
  })

  it('never pairs an argument with itself and never repeats a pair', () => {
    const pairs = selectArgumentPairs({
      questionId: Q,
      voterId: 'voter',
      candidates: [candidate(1, 80), candidate(2, 20), candidate(3, 50)],
      alreadyCompared: [],
      maxPairs: 10,
    })
    expect(pairs).toHaveLength(3)
    expect(new Set(pairs.map(keyOf)).size).toBe(3)
    for (const p of pairs) expect(p.a.id).not.toBe(p.b.id)
  })

  it('returns [] with fewer than two usable texts', () => {
    expect(
      selectArgumentPairs({ questionId: Q, voterId: 'voter', candidates: [], alreadyCompared: [] }),
    ).toEqual([])
    expect(
      selectArgumentPairs({
        questionId: Q,
        voterId: 'voter',
        candidates: [candidate(1, 80)],
        alreadyCompared: [],
      }),
    ).toEqual([])
    expect(
      selectArgumentPairs({
        questionId: Q,
        voterId: 'voter',
        candidates: [
          candidate(1, 80),
          candidate(2, 20, { text: '   ' }),
          candidate(3, 50, { text: '' }),
          candidate(4, 50, { text: '  \n\t' }),
        ],
        alreadyCompared: [],
      }),
    ).toEqual([])
    expect(
      selectArgumentPairs({
        questionId: Q,
        voterId: 'p1',
        candidates: [candidate(1, 80), candidate(2, 20)],
        alreadyCompared: [],
      }),
    ).toEqual([])
  })

  it('tolerates garbage rows without throwing', () => {
    const candidates = [
      candidate(1, 80),
      candidate(2, 20),
      candidate(2, 20, { text: 'duplicate id' }),
      candidate(3, 50, { text: null as unknown as string }),
      candidate(4, Number.NaN),
      null as unknown as ArgumentCandidate,
      { submissionId: 5 } as unknown as ArgumentCandidate,
    ]
    const pairs = selectArgumentPairs({
      questionId: Q,
      voterId: 'voter',
      candidates,
      alreadyCompared: [null, {}, { a: 'x' }, { a: 's1', b: 'nobody' }] as unknown as { a: string; b: string }[],
      maxPairs: 10,
    })
    // s1, s2 (first occurrence), s4 survive: three pairs, no duplicate id, no null text.
    expect(pairs).toHaveLength(3)
    expect(new Set(pairs.map(keyOf)).size).toBe(3)
    for (const p of pairs) {
      expect(p.a.id).not.toBe(p.b.id)
      expect(typeof p.a.text).toBe('string')
      expect(typeof p.b.text).toBe('string')
      expect([p.a.text, p.b.text]).not.toContain('duplicate id')
    }
    expect(
      selectArgumentPairs({
        questionId: Q,
        voterId: 'voter',
        candidates: undefined as unknown as ArgumentCandidate[],
        alreadyCompared: undefined as unknown as { a: string; b: string }[],
      }),
    ).toEqual([])
  })

  it('keys compared pairs so ids containing spaces cannot collide', () => {
    const candidates = [
      candidate(1, 80, { submissionId: 'a b' }),
      candidate(2, 20, { submissionId: 'c' }),
      candidate(3, 80, { submissionId: 'a' }),
      candidate(4, 20, { submissionId: 'b c' }),
    ]
    const pairs = selectArgumentPairs({
      questionId: Q,
      voterId: 'voter',
      candidates,
      alreadyCompared: [{ a: 'a b', b: 'c' }],
      maxPairs: Number.POSITIVE_INFINITY,
    })
    // 6 pairs minus the one compared; the pair (a, b c) must survive.
    expect(pairs).toHaveLength(5)
    expect(pairs.map(keyOf)).toContain('a|b c')
    expect(pairs.map(keyOf)).not.toContain('a b|c')
  })

  it('emits only opaque ids and trimmed texts', () => {
    const pairs = selectArgumentPairs({
      questionId: Q,
      voterId: 'voter',
      candidates: [candidate(1, 80, { text: '  padded  ' }), candidate(2, 20)],
      alreadyCompared: [],
    })
    expect(pairs).toHaveLength(1)
    const [p] = pairs
    expect(Object.keys(p).sort()).toEqual(['a', 'b'])
    expect(Object.keys(p.a).sort()).toEqual(['id', 'text'])
    const texts = [p.a.text, p.b.text]
    expect(texts).toContain('padded')
    expect(texts).toContain('argument 2')
  })
})
