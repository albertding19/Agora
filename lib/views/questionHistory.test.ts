import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { QuestionRow } from '@/lib/db/types'
import { QuestionHistory } from '@/lib/types'
import { buildQuestionHistory } from './questionHistory'

const T0 = Date.parse('2026-09-20T10:00:00.000Z')
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString()

const Q_ID = '11111111-1111-4111-8111-111111111111'
const ALICE = '22222222-2222-4222-8222-222222222222'
const BOB = '33333333-3333-4333-8333-333333333333'

type Raw = Record<string, unknown>

/**
 * A stand-in for the Supabase client: `from(table)` returns a chainable,
 * awaitable builder that resolves to that table's rows, so the real row
 * mappers in lib/db/queries run (numerics arrive as strings, as from
 * PostgREST). Filters are ignored; every fixture belongs to one question.
 */
function fakeClient(tables: Record<string, Raw[]>): SupabaseClient {
  const from = (table: string) => {
    const rows = tables[table] ?? []
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      then: (resolve: (v: { data: Raw[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
    }
    return builder
  }
  return { from } as unknown as SupabaseClient
}

function question(overrides: Partial<QuestionRow> = {}): QuestionRow {
  return {
    id: Q_ID,
    session_id: 's1',
    order_index: 0,
    proposition: 'The ball costs 10 cents.',
    mode: 'stem',
    correct_answer: false,
    phase: 'snapshot',
    phase_started_at: at(60),
    phase_ends_at: null,
    liquidity_b: 200,
    n_at_start: 5,
    blind_price_pct: 55,
    post_price_pct: null,
    blind_revealed: false,
    reference_answer: null,
    source_question_id: null,
    cascade_mode: true,
    phase_log: [
      { phase: 'blind', at: at(0) },
      { phase: 'snapshot', at: at(60) },
    ],
    sp_actual_true_pct: null,
    sp_predicted_true_pct: null,
    sp_answer: null,
    created_at: at(-10),
    ...overrides,
  }
}

function trade(over: Raw): Raw {
  return { id: 'tr', question_id: Q_ID, phase: 'blind', pct_before: null, ...over }
}

function submission(over: Raw): Raw {
  return { id: 'su', question_id: Q_ID, reasoning: null, cluster_index: null, ...over }
}

describe('buildQuestionHistory', () => {
  it('walks a cascade blind through submit and consider-the-opposite trades, with anonymous notes', async () => {
    // Alice submits 90 (price 50 → 59.9), then gives a second number so her
    // blind number becomes 50 (price back to 50); Bob submits 70 (→ 55). Both
    // moves by Alice are blind trades (submit and oppose log alike), so the
    // arc's blind segment follows the number the projector showed.
    const client = fakeClient({
      trades: [
        trade({ participant_id: ALICE, created_at: at(10), pct_after: 90, price_before_pct: '50', price_after_pct: '59.87' }),
        trade({ participant_id: ALICE, created_at: at(20), pct_before: 90, pct_after: 50, price_before_pct: '59.87', price_after_pct: '50' }),
        trade({ participant_id: BOB, created_at: at(30), pct_after: 70, price_before_pct: '50', price_after_pct: '55.0' }),
      ],
      submissions: [
        submission({ participant_id: ALICE, blind_pct: 50, first_pct: 90, opposite_pct: 10, reasoning: 'it adds up', cluster_index: 0 }),
        submission({ participant_id: BOB, blind_pct: 70, reasoning: '  the ball is five cents  ' }),
      ],
      clusters: [{ id: 'c0', question_id: Q_ID, idx: 0, label: 'Reads the sum as the price', member_ids: [ALICE] }],
    })

    const history = await buildQuestionHistory(client, question(), new Date(T0 + 90_000))

    expect(history.points).toEqual([
      { t: at(0), pct: 50, phase: 'blind', note: null },
      { t: at(10), pct: 59.9, phase: 'blind', note: 'Reads the sum as the price' },
      { t: at(20), pct: 50, phase: 'blind', note: 'Reads the sum as the price' },
      { t: at(30), pct: 55, phase: 'blind', note: 'the ball is five cents' },
      { t: at(60), pct: 55, phase: 'snapshot', note: null },
    ])
    expect(history).toMatchObject({
      questionId: Q_ID,
      index: 0,
      mode: 'stem',
      phase: 'snapshot',
      outcome: false,
      cascade: true,
      blindPricePct: 55,
      postPricePct: null,
    })
    expect(QuestionHistory.parse(history)).toEqual(history)

    // Aggregates only: no participant id, no per-student number, no move size.
    const wire = JSON.stringify(history)
    expect(wire).not.toContain(ALICE)
    expect(wire).not.toContain(BOB)
    expect(wire).not.toContain('pct_before')
    expect(wire).not.toContain('pct_after')
  })

  it('treats the "Other" bucket and an "Argument N" stand-in as no label and quotes the reasoning instead', async () => {
    const CY = '44444444-4444-4444-8444-444444444444'
    const client = fakeClient({
      trades: [
        trade({ participant_id: ALICE, created_at: at(10), pct_after: 90, price_before_pct: '50', price_after_pct: '59.87' }),
        trade({ participant_id: BOB, created_at: at(20), pct_before: null, pct_after: 70, price_before_pct: '59.87', price_after_pct: '64.1' }),
        trade({ participant_id: CY, created_at: at(30), pct_before: null, pct_after: 30, price_before_pct: '64.1', price_after_pct: '55.0' }),
      ],
      submissions: [
        submission({ participant_id: ALICE, blind_pct: 90, reasoning: 'it adds up', cluster_index: 0 }),
        submission({ participant_id: BOB, blind_pct: 70, reasoning: 'a hunch', cluster_index: 1 }),
        submission({ participant_id: CY, blind_pct: 30, reasoning: '', cluster_index: 1 }),
      ],
      clusters: [
        { id: 'c0', question_id: Q_ID, idx: 0, label: 'Argument 1', member_ids: [ALICE] },
        { id: 'c1', question_id: Q_ID, idx: 1, label: 'Other', member_ids: [BOB, CY] },
      ],
    })

    const history = await buildQuestionHistory(client, question(), new Date(T0 + 90_000))

    expect(history.points.map((pt) => pt.note)).toEqual([null, 'it adds up', 'a hunch', null, null])
    expect(JSON.stringify(history)).not.toContain('Argument 1')
    expect(JSON.stringify(history)).not.toContain('Other')
  })

  it('has no history for a non-cascade question still in blind (the P0 path is unchanged)', async () => {
    const client = fakeClient({
      trades: [trade({ participant_id: ALICE, created_at: at(10), pct_after: 90, price_before_pct: '50', price_after_pct: '59.87' })],
      submissions: [submission({ participant_id: ALICE, blind_pct: 90 })],
      clusters: [],
    })
    const history = await buildQuestionHistory(
      client,
      question({ cascade_mode: false, phase: 'blind', phase_started_at: at(0), phase_log: [{ phase: 'blind', at: at(0) }], blind_price_pct: null }),
    )
    expect(history.points).toEqual([])
    expect(history.cascade).toBe(false)
  })

  it('leaves the note null for a mover with no reasoning and no cluster, and never resolves an outcome for humanities', async () => {
    const client = fakeClient({
      trades: [trade({ participant_id: BOB, phase: 'open', created_at: at(190), pct_before: 70, pct_after: 40, price_before_pct: '55', price_after_pct: '47.2' })],
      submissions: [submission({ participant_id: BOB, blind_pct: 70, current_pct: 40, reasoning: '   ' })],
      clusters: [],
    })
    const history = await buildQuestionHistory(
      client,
      question({
        mode: 'humanities',
        correct_answer: null,
        cascade_mode: false,
        phase: 'resolved',
        phase_started_at: at(240),
        post_price_pct: 47.2,
        phase_log: [
          { phase: 'blind', at: at(0) },
          { phase: 'snapshot', at: at(60) },
          { phase: 'structured', at: at(90) },
          { phase: 'open', at: at(180) },
          { phase: 'resolved', at: at(240) },
        ],
      }),
    )
    expect(history.outcome).toBeNull()
    expect(history.points).toEqual([
      { t: at(60), pct: 55, phase: 'snapshot', note: null },
      { t: at(180), pct: 55, phase: 'open', note: null },
      { t: at(190), pct: 47.2, phase: 'open', note: null },
      { t: at(240), pct: 47.2, phase: 'resolved', note: null },
    ])
  })
})
