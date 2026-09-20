/**
 * The database-aware transitions, with the query layer mocked. Covers the
 * pure mapping (`toStates`) and the one raw client write in this file: the
 * snapshot recompute dropping Socrates questions before it regroups.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParticipantRow, QuestionRow, SessionRow, SubmissionRow } from '@/lib/db/types'

vi.mock('@/lib/db/queries', () => ({
  getQuestion: vi.fn(),
  listParticipants: vi.fn(),
  listSubmissions: vi.fn(),
  listGroups: vi.fn(),
  upsertGroups: vi.fn(),
  upsertSubmissionPatches: vi.fn(),
  updateQuestion: vi.fn(),
  updateSession: vi.fn(),
  bumpTick: vi.fn(),
}))

import * as q from '@/lib/db/queries'
import { advance, recomputeSnapshot, toStates } from './advance'

const NOW = new Date('2026-09-20T10:00:00Z')

function session(): SessionRow {
  return {
    id: 'session-1',
    code: 'AGORA1',
    title: 'Demo',
    teacher_token: 'token',
    budget: 100,
    k: 0.4,
    blind_seconds: 75,
    turn_seconds: 30,
    open_seconds: 60,
    current_question_id: 'question-1',
    status: 'active',
    classroom_id: null,
    features: { socrates: true },
    created_at: NOW.toISOString(),
  }
}

function question(overrides: Partial<QuestionRow> = {}): QuestionRow {
  return {
    id: 'question-1',
    session_id: 'session-1',
    order_index: 0,
    proposition: 'The ball costs 10 cents.',
    mode: 'stem',
    correct_answer: false,
    phase: 'snapshot',
    phase_started_at: NOW.toISOString(),
    phase_ends_at: null,
    liquidity_b: 200,
    n_at_start: 5,
    blind_price_pct: 60,
    post_price_pct: null,
    blind_revealed: false,
    reference_answer: null,
    source_question_id: null,
    cascade_mode: false,
    phase_log: [{ phase: 'blind', at: NOW.toISOString() }],
    sp_actual_true_pct: null,
    sp_predicted_true_pct: null,
    sp_answer: null,
    created_at: NOW.toISOString(),
    ...overrides,
  }
}

function submission(overrides: Partial<SubmissionRow> & { participant_id: string }): SubmissionRow {
  return {
    id: `sub-${overrides.participant_id}`,
    question_id: 'question-1',
    reasoning: null,
    ai_stance: null,
    ai_band_lo: null,
    ai_band_hi: null,
    ai_reading: null,
    blind_pct: 70,
    blind_submitted_at: NOW.toISOString(),
    current_pct: null,
    final_pct: null,
    group_id: null,
    cluster_index: null,
    calibration_final: null,
    calibration_blind: null,
    persuasion: null,
    first_pct: null,
    opposite_pct: null,
    opposite_reasoning: null,
    predicted_true_pct: null,
    sp_insight: null,
    steelman_text: null,
    steelman_score: null,
    steelman_note: null,
    contrarian_bonus: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  }
}

function participants(ids: string[]): ParticipantRow[] {
  return ids.map((id) => ({ id, session_id: 'session-1', display_name: id, joined_at: NOW.toISOString() }))
}

interface RawWrite {
  table: string
  payload: unknown
  filter: [string, unknown]
}

/** A client that records every raw `from(...).update(...).eq(...)` and logs it in order with the mocked queries. */
function fakeClient(log: string[]) {
  const writes: RawWrite[] = []
  const client = {
    from(table: string) {
      return {
        update(payload: unknown) {
          return {
            eq(column: string, value: unknown) {
              writes.push({ table, payload, filter: [column, value] })
              log.push(`update ${table}`)
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
  }
  return { client: client as unknown as SupabaseClient, writes }
}

describe('toStates', () => {
  it('threads the first number, falling back to the engine number', () => {
    const states = toStates([
      submission({ participant_id: 'a', blind_pct: 50, first_pct: 85, opposite_pct: 15, predicted_true_pct: 80 }),
      submission({ participant_id: 'b', blind_pct: 70, first_pct: null }),
      submission({ participant_id: 'c', blind_pct: null, first_pct: null, blind_submitted_at: null }),
    ])
    expect(states).toEqual([
      { participantId: 'a', blindPct: 50, currentPct: null, predictedTruePct: 80, firstPct: 85 },
      { participantId: 'b', blindPct: 70, currentPct: null, predictedTruePct: null, firstPct: 70 },
      { participantId: 'c', blindPct: null, currentPct: null, predictedTruePct: null, firstPct: null },
    ])
  })
})

describe('recomputeSnapshot', () => {
  let log: string[]

  beforeEach(() => {
    vi.resetAllMocks()
    log = []
    vi.mocked(q.listParticipants).mockResolvedValue(participants(['a', 'b', 'c', 'd', 'e', 'f']))
    vi.mocked(q.listSubmissions).mockResolvedValue(
      ['a', 'b', 'c', 'd', 'e'].map((id) => submission({ participant_id: id, predicted_true_pct: 80 })),
    )
    vi.mocked(q.upsertGroups).mockImplementation(async () => {
      log.push('upsertGroups')
      return []
    })
    vi.mocked(q.updateQuestion).mockImplementation(async (_client, _id, fields) => ({ ...question(), ...fields }))
    vi.mocked(q.bumpTick).mockResolvedValue(undefined)
  })

  it('drops the Socrates questions before it regroups, so no poll sees them under a new turn order', async () => {
    const { client, writes } = fakeClient(log)
    await recomputeSnapshot(client, session(), question())

    expect(writes).toEqual([{ table: 'groups', payload: { socratic_questions: null }, filter: ['question_id', 'question-1'] }])
    expect(log).toEqual(['update groups', 'upsertGroups'])
    expect(q.upsertGroups).toHaveBeenCalledTimes(1)
    // Two groups of three for six participants: the regroup that makes the old questions wrong.
    expect(vi.mocked(q.upsertGroups).mock.calls[0][2]).toHaveLength(2)
    expect(q.updateQuestion).toHaveBeenCalledWith(
      client,
      'question-1',
      expect.objectContaining({ blind_price_pct: expect.any(Number), sp_predicted_true_pct: 80 }),
    )
    expect(q.bumpTick).toHaveBeenCalledWith(client, 'session-1')
  })

  it('writes nothing outside the snapshot phase or for an open question', async () => {
    const { client, writes } = fakeClient(log)
    await expect(recomputeSnapshot(client, session(), question({ phase: 'structured' }))).rejects.toMatchObject({
      status: 409,
      code: 'not_in_snapshot',
    })
    await expect(recomputeSnapshot(client, session(), question({ mode: 'open', correct_answer: null }))).rejects.toMatchObject({
      status: 409,
      code: 'open_mode',
    })
    expect(writes).toEqual([])
    expect(q.upsertGroups).not.toHaveBeenCalled()
    expect(q.updateQuestion).not.toHaveBeenCalled()
  })

  it('leaves the blind → snapshot transition alone: groups are only upserted there', async () => {
    const { client, writes } = fakeClient(log)
    const blind = question({ phase: 'blind', phase_ends_at: NOW.toISOString(), blind_price_pct: null })
    const updated = await advance(client, session(), blind, 'blind', NOW)

    expect(updated.phase).toBe('snapshot')
    expect(writes).toEqual([])
    expect(log).toEqual(['upsertGroups'])
    expect(q.updateQuestion).toHaveBeenCalledWith(
      client,
      'question-1',
      expect.objectContaining({ phase: 'snapshot', sp_predicted_true_pct: 80 }),
      { phase: 'blind' },
    )
  })
})
