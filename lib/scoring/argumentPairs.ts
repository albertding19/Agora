/**
 * Pair selection for the post-resolution argument duel (plan 17.9b).
 *
 * Each student is shown up to `maxPairs` pairs of anonymous classmate
 * arguments and taps the more convincing one. Selection is a pure function
 * of the inputs and seeded by `(questionId, voterId)`, so the 2 s view poll
 * never reshuffles a pair under a thumb, and a different voter walks the
 * pool in a different order.
 *
 * The voter's complete sequence of pairs is built first, without looking at
 * what they have already compared; compared pairs are then dropped and the
 * head of what remains is returned. That is what keeps a vote from moving
 * anything: the pair the phone advanced to optimistically is exactly the
 * first pair of the next poll, in the same orientation.
 *
 * Sequence:
 *  - the pool excludes the voter's own submission and empty/whitespace texts;
 *    fewer than two left -> no pairs;
 *  - pass 1 uses each candidate at most once, pairing it with the first later
 *    unused candidate of the opposite blind lean when one exists, else the
 *    first later unused candidate;
 *  - pass 2 adds every remaining opposite-lean pair, then every remaining
 *    pair, so opposite leans always come first;
 *  - each position's a/b order is flipped by a seeded coin so position
 *    carries no signal.
 *
 * Only opaque submission ids and texts leave this function; no names.
 */

import { fnv1a32, mulberry32, seededShuffle } from '@/lib/scoring/prng'
import type { ArgumentPair } from '@/lib/types'

export interface ArgumentCandidate {
  submissionId: string
  participantId: string
  text: string
  blindPct: number | null
}

export interface SelectArgumentPairsInput {
  questionId: string
  voterId: string
  candidates: readonly ArgumentCandidate[]
  /** Unordered pairs of submission ids this voter has already compared. */
  alreadyCompared: readonly { a: string; b: string }[]
  /** Upper bound on pairs returned. Default 3. */
  maxPairs?: number
}

const DEFAULT_MAX_PAIRS = 3

type Side = 'TRUE' | 'FALSE' | null

function sideOf(blindPct: number | null): Side {
  if (typeof blindPct !== 'number' || !Number.isFinite(blindPct)) return null
  if (blindPct > 50) return 'TRUE'
  if (blindPct < 50) return 'FALSE'
  return null
}

/** Order-independent key for an unordered pair of ids. NUL never appears in an id. */
function pairKey(x: string, y: string): string {
  return x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`
}

function oppositeSides(x: Side, y: Side): boolean {
  return x !== null && y !== null && x !== y
}

function byId(x: ArgumentCandidate, y: ArgumentCandidate): number {
  if (x.submissionId < y.submissionId) return -1
  if (x.submissionId > y.submissionId) return 1
  return 0
}

function normalizeMaxPairs(raw: number | undefined): number {
  if (raw === undefined || Number.isNaN(raw)) return DEFAULT_MAX_PAIRS
  if (raw === Infinity) return Infinity
  return Math.max(0, Math.floor(raw))
}

export function selectArgumentPairs(input: SelectArgumentPairsInput): ArgumentPair[] {
  const maxPairs = normalizeMaxPairs(input.maxPairs)
  if (maxPairs <= 0) return []

  // One row per submission id; the first occurrence wins.
  const seen = new Set<string>()
  const pool: ArgumentCandidate[] = []
  for (const c of input.candidates ?? []) {
    if (!c || typeof c.submissionId !== 'string' || typeof c.text !== 'string') continue
    if (c.participantId === input.voterId) continue
    if (c.text.trim().length === 0) continue
    if (seen.has(c.submissionId)) continue
    seen.add(c.submissionId)
    pool.push(c)
  }
  // Sort before shuffling so the result does not depend on the caller's
  // row order, only on the seed.
  pool.sort(byId)
  if (pool.length < 2) return []

  const rnd = mulberry32(fnv1a32(`${input.questionId}:${input.voterId}`))
  const order = seededShuffle(pool, rnd)
  const sides = order.map((c) => sideOf(c.blindPct))

  // The voter's full sequence of unordered pairs, as index pairs into `order`.
  const built = new Set<string>()
  const sequence: [number, number][] = []
  const add = (i: number, j: number) => {
    const key = pairKey(order[i].submissionId, order[j].submissionId)
    if (built.has(key)) return
    built.add(key)
    sequence.push([i, j])
  }

  // Pass 1: every candidate at most once, opposite leans first.
  const used = new Set<number>()
  for (let i = 0; i < order.length; i++) {
    if (used.has(i)) continue
    let match = -1
    for (let j = i + 1; j < order.length; j++) {
      if (used.has(j)) continue
      if (oppositeSides(sides[i], sides[j])) {
        match = j
        break
      }
      if (match === -1) match = j
    }
    if (match === -1) continue
    used.add(i)
    used.add(match)
    add(i, match)
  }

  // Pass 2: every remaining opposite-lean pair, then every remaining pair.
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      if (oppositeSides(sides[i], sides[j])) add(i, j)
    }
  }
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) add(i, j)
  }

  // Orientation is one seeded coin per sequence position, fixed per voter.
  const oriented: ArgumentPair[] = sequence.map(([i, j]) => {
    const first = { id: order[i].submissionId, text: order[i].text.trim() }
    const second = { id: order[j].submissionId, text: order[j].text.trim() }
    return rnd() < 0.5 ? { a: second, b: first } : { a: first, b: second }
  })

  // Drop what this voter has already compared and return the head.
  const compared = new Set<string>()
  for (const pair of input.alreadyCompared ?? []) {
    if (!pair || typeof pair.a !== 'string' || typeof pair.b !== 'string') continue
    compared.add(pairKey(pair.a, pair.b))
  }
  const remaining = oriented.filter((p) => !compared.has(pairKey(p.a.id, p.b.id)))
  return maxPairs === Infinity ? remaining : remaining.slice(0, maxPairs)
}
