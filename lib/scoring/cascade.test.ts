import { describe, expect, it } from 'vitest'
import type { QuestionRow } from '@/lib/db/types'
import { cascadeReading, findCascadePair, normalizeProposition } from './cascade'

function q(overrides: Partial<QuestionRow> & { id: string; order_index: number }): QuestionRow {
  return {
    session_id: 's1',
    proposition: 'The bat costs $1.00.',
    mode: 'stem',
    correct_answer: false,
    phase: 'resolved',
    phase_started_at: null,
    phase_ends_at: null,
    liquidity_b: null,
    n_at_start: null,
    blind_price_pct: null,
    post_price_pct: null,
    blind_revealed: false,
    reference_answer: null,
    source_question_id: null,
    cascade_mode: false,
    phase_log: [],
    sp_actual_true_pct: null,
    sp_predicted_true_pct: null,
    sp_answer: null,
    created_at: '2026-09-20T00:00:00.000Z',
    ...overrides,
  }
}

describe('normalizeProposition', () => {
  it('trims, collapses whitespace, and lowercases', () => {
    expect(normalizeProposition('  The  Bat\tcosts\n $1.00.  ')).toBe('the bat costs $1.00.')
  })
  it('leaves an already-normal string alone', () => {
    expect(normalizeProposition('0.999… < 1')).toBe('0.999… < 1')
  })
  it('collapses Unicode whitespace (no-break and ideographic spaces) too', () => {
    expect(normalizeProposition('\u00a0A\u00a0\u00a0B\u3000C\u2003')).toBe('a b c')
  })
  it('returns an empty string for a missing or blank value instead of throwing', () => {
    expect(normalizeProposition('   ')).toBe('')
    expect(normalizeProposition(undefined as unknown as string)).toBe('')
    expect(normalizeProposition(null as unknown as string)).toBe('')
  })
})

describe('findCascadePair', () => {
  it('pairs a cascade run with the blind run of the same proposition despite case and whitespace differences', () => {
    const blind = q({ id: 'b', order_index: 0, proposition: 'The bat costs $1.00.', blind_price_pct: 78 })
    const cascade = q({
      id: 'c',
      order_index: 1,
      proposition: '  the BAT   costs $1.00. ',
      cascade_mode: true,
      phase: 'snapshot',
      blind_price_pct: 88,
    })
    const pair = findCascadePair([blind, cascade])
    expect(pair).not.toBeNull()
    expect(pair!.blind.id).toBe('b')
    expect(pair!.cascade.id).toBe('c')
  })

  it('returns null when the blind run has no blind price yet', () => {
    const blind = q({ id: 'b', order_index: 0, blind_price_pct: null, phase: 'blind' })
    const cascade = q({ id: 'c', order_index: 1, cascade_mode: true, phase: 'snapshot', blind_price_pct: 88 })
    expect(findCascadePair([blind, cascade])).toBeNull()
  })

  it('returns null when there is no cascade question', () => {
    const a = q({ id: 'a', order_index: 0, blind_price_pct: 78 })
    const b = q({ id: 'b', order_index: 1, blind_price_pct: 80 })
    expect(findCascadePair([a, b])).toBeNull()
    expect(findCascadePair([])).toBeNull()
  })

  it('ignores a cascade question that is still pending', () => {
    const blind = q({ id: 'b', order_index: 0, blind_price_pct: 78 })
    const cascade = q({ id: 'c', order_index: 1, cascade_mode: true, phase: 'pending' })
    expect(findCascadePair([blind, cascade])).toBeNull()
  })

  it('does not pair two runs of different propositions', () => {
    const blind = q({ id: 'b', order_index: 0, proposition: '0.999… < 1', blind_price_pct: 70 })
    const cascade = q({ id: 'c', order_index: 1, cascade_mode: true, phase: 'open', blind_price_pct: 88 })
    expect(findCascadePair([blind, cascade])).toBeNull()
  })

  it('prefers the latest cascade run when two exist', () => {
    const blind = q({ id: 'b', order_index: 0, blind_price_pct: 78 })
    const older = q({ id: 'c1', order_index: 1, cascade_mode: true, phase: 'resolved', blind_price_pct: 85 })
    const newer = q({ id: 'c2', order_index: 2, cascade_mode: true, phase: 'snapshot', blind_price_pct: 90 })
    // Input order is not sorted, to prove the helper sorts by order_index.
    const pair = findCascadePair([newer, blind, older])
    expect(pair!.cascade.id).toBe('c2')
    expect(pair!.blind.id).toBe('b')
  })

  it('falls back to an older cascade run when the latest has no matching blind run', () => {
    const blind = q({ id: 'b', order_index: 0, proposition: 'A', blind_price_pct: 78 })
    const older = q({ id: 'c1', order_index: 1, proposition: 'A', cascade_mode: true, phase: 'open', blind_price_pct: 85 })
    const newer = q({ id: 'c2', order_index: 2, proposition: 'B', cascade_mode: true, phase: 'open', blind_price_pct: 60 })
    const pair = findCascadePair([blind, older, newer])
    expect(pair!.cascade.id).toBe('c1')
  })

  it('never pairs a cascade run with another cascade run', () => {
    const c1 = q({ id: 'c1', order_index: 0, cascade_mode: true, phase: 'resolved', blind_price_pct: 85 })
    const c2 = q({ id: 'c2', order_index: 1, cascade_mode: true, phase: 'snapshot', blind_price_pct: 90 })
    expect(findCascadePair([c1, c2])).toBeNull()
  })

  it('uses the blind run that preceded the cascade, not a blind re-run added afterwards', () => {
    // Blind (0) → cascade (1) → the teacher re-adds the question blind (2) and runs it.
    // The baseline the class actually experienced first is run 0.
    const first = q({ id: 'b0', order_index: 0, blind_price_pct: 78 })
    const cascade = q({ id: 'c', order_index: 1, cascade_mode: true, phase: 'resolved', blind_price_pct: 90 })
    const rerun = q({ id: 'b2', order_index: 2, blind_price_pct: 60 })
    const pair = findCascadePair([rerun, cascade, first])
    expect(pair!.blind.id).toBe('b0')
    expect(pair!.cascade.id).toBe('c')
  })

  it('prefers the latest of several blind runs that preceded the cascade', () => {
    const b0 = q({ id: 'b0', order_index: 0, blind_price_pct: 70 })
    const b1 = q({ id: 'b1', order_index: 1, blind_price_pct: 78 })
    const cascade = q({ id: 'c', order_index: 2, cascade_mode: true, phase: 'open', blind_price_pct: 90 })
    expect(findCascadePair([b0, b1, cascade])!.blind.id).toBe('b1')
  })

  it('falls back to a later blind run only when none preceded the cascade', () => {
    const cascade = q({ id: 'c', order_index: 0, cascade_mode: true, phase: 'resolved', blind_price_pct: 90 })
    const later = q({ id: 'b', order_index: 1, blind_price_pct: 78 })
    expect(findCascadePair([cascade, later])!.blind.id).toBe('b')
  })

  it('never pairs blank propositions with each other', () => {
    const blind = q({ id: 'b', order_index: 0, proposition: '   ', blind_price_pct: 78 })
    const cascade = q({ id: 'c', order_index: 1, proposition: ' \t ', cascade_mode: true, phase: 'open' })
    expect(findCascadePair([blind, cascade])).toBeNull()
  })

  it('does not mutate or reorder the input and is deterministic', () => {
    const blind = q({ id: 'b', order_index: 0, blind_price_pct: 78 })
    const c1 = q({ id: 'c1', order_index: 1, cascade_mode: true, phase: 'resolved', blind_price_pct: 85 })
    const c2 = q({ id: 'c2', order_index: 2, cascade_mode: true, phase: 'snapshot' })
    const input = [c2, blind, c1]
    const a = findCascadePair(input)
    const b = findCascadePair(input)
    expect(input.map((x) => x.id)).toEqual(['c2', 'b', 'c1'])
    expect(a).toEqual(b)
    expect(a!.cascade.id).toBe('c2')
  })

  it('pairs a cascade question that is still in its blind phase (no blind price yet)', () => {
    const blind = q({ id: 'b', order_index: 0, blind_price_pct: 78 })
    const cascade = q({ id: 'c', order_index: 1, cascade_mode: true, phase: 'blind', blind_price_pct: null })
    expect(findCascadePair([blind, cascade])!.cascade.id).toBe('c')
  })
})

describe('cascadeReading', () => {
  it('names herding for a gap of at least 10 points toward the majority', () => {
    expect(cascadeReading(78, 90)).toBe(
      'Seeing the consensus pulled the class 12 points further toward it. That is herding — a dynamic of the room, not of any one student.',
    )
    // A FALSE-leaning majority moving further toward FALSE.
    expect(cascadeReading(30, 15)).toBe(
      'Seeing the consensus pulled the class 15 points further toward it. That is herding — a dynamic of the room, not of any one student.',
    )
  })

  it('reports a small pull for a gap of 5 to 10 points toward the majority', () => {
    expect(cascadeReading(78, 84)).toBe('A small pull toward the visible consensus.')
    expect(cascadeReading(30, 25)).toBe('A small pull toward the visible consensus.')
  })

  it('reports movement away from the consensus for a gap of at least 5 points against the majority', () => {
    expect(cascadeReading(78, 70)).toBe('The class moved 8 points away from the visible consensus. No herding here.')
    expect(cascadeReading(30, 45)).toBe('The class moved 15 points away from the visible consensus. No herding here.')
  })

  it('reports barely any movement for a gap under 5 points', () => {
    expect(cascadeReading(78, 80)).toBe('Seeing the consensus barely moved the class.')
    expect(cascadeReading(78, 75)).toBe('Seeing the consensus barely moved the class.')
    expect(cascadeReading(78, 78)).toBe('Seeing the consensus barely moved the class.')
  })

  it('treats a blind price of exactly 50 as having no majority', () => {
    expect(cascadeReading(50, 65)).toBe('The class moved 15 points away from the visible consensus. No herding here.')
    expect(cascadeReading(50, 35)).toBe('The class moved 15 points away from the visible consensus. No herding here.')
    expect(cascadeReading(50, 50)).toBe('Seeing the consensus barely moved the class.')
  })

  it('prints the gap to one decimal without a trailing .0', () => {
    expect(cascadeReading(78, 90.34)).toContain('12.3 points')
    expect(cascadeReading(78, 90.0)).toContain('12 points')
    expect(cascadeReading(60, 49.5)).toContain('10.5 points')
    // 88.2 − 77.6 = 10.599999999999994 in floating point; still prints 10.6 and still counts as ≥ 10.
    expect(cascadeReading(77.6, 88.2)).toBe(
      'Seeing the consensus pulled the class 10.6 points further toward it. That is herding — a dynamic of the room, not of any one student.',
    )
  })

  it('applies the thresholds to the raw gap at the exact boundaries (10, 5) in both directions', () => {
    // 78 → 88: gap +10, toward the TRUE majority.
    expect(cascadeReading(78, 88)).toContain('pulled the class 10 points')
    // 78 → 83: gap +5, toward.
    expect(cascadeReading(78, 83)).toBe('A small pull toward the visible consensus.')
    // 78 → 73: gap −5, away.
    expect(cascadeReading(78, 73)).toBe('The class moved 5 points away from the visible consensus. No herding here.')
    // 78 → 82.9 and 78 → 87.9: just under each threshold.
    expect(cascadeReading(78, 82.9)).toBe('Seeing the consensus barely moved the class.')
    expect(cascadeReading(78, 87.9)).toBe('A small pull toward the visible consensus.')
    // A FALSE-leaning class crossing 50 is "away", whatever the size.
    expect(cascadeReading(45, 55)).toBe('The class moved 10 points away from the visible consensus. No herding here.')
    expect(cascadeReading(55, 45)).toBe('The class moved 10 points away from the visible consensus. No herding here.')
  })

  it('is deterministic', () => {
    expect(cascadeReading(78, 90)).toBe(cascadeReading(78, 90))
  })

  it('never names a student', () => {
    for (const [b, c] of [
      [78, 90],
      [78, 84],
      [78, 70],
      [78, 80],
    ] as const) {
      expect(cascadeReading(b, c)).not.toMatch(/\b(you|student's|named)\b/i)
    }
  })
})
