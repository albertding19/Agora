/**
 * Student view: the flag gates on the §17 fields. The database is a mocked
 * query module; the lazy phase timer is stubbed so every fixture question
 * stays in its phase. Every built view is re-parsed through the `StudentView`
 * contract so a field that drifts from lib/types.ts fails here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GroupRow, ParticipantRow, QuestionRow, SubmissionRow } from '@/lib/db/types'
import { StudentView } from '@/lib/types'
import { buildStudentView } from '@/lib/views/studentView'
import { NOW, P1, P2, P3, groupRow, participantRow, questionRow, sessionRow, submissionRow } from './fixtures'

const db = vi.hoisted(() => ({
  questions: [] as QuestionRow[],
  participants: [] as ParticipantRow[],
  submissions: [] as SubmissionRow[],
  groups: [] as GroupRow[],
}))

vi.mock('@/lib/db/queries', () => ({
  listQuestions: async () => db.questions,
  getQuestion: async (_client: unknown, id: string) => db.questions.find((qu) => qu.id === id) ?? null,
  listParticipants: async () => db.participants,
  listSubmissions: async () => db.submissions,
  listSubmissionsForQuestions: async () => [],
  listGroups: async () => db.groups,
  listArgumentVotes: async () => [],
}))

// The lazy timer is not under test: a fixture question stays where it is.
vi.mock('@/lib/phases/advance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/phases/advance')>()
  return { ...actual, maybeAdvance: async (_c: unknown, _s: unknown, question: QuestionRow) => question }
})

const client = {} as SupabaseClient

async function view(features: Record<string, boolean>) {
  return StudentView.parse(await buildStudentView(client, sessionRow({ features }), db.participants[0], NOW))
}

describe('studentView — consider the opposite (§17.1) is gated on the flag', () => {
  beforeEach(() => {
    db.questions = [questionRow({ phase: 'snapshot' })]
    db.participants = [participantRow(P1, 'Ada')]
    // A second number recorded while the flag was on: blind_pct is the blend.
    db.submissions = [
      submissionRow({
        participant_id: P1,
        first_pct: 70,
        opposite_pct: 40,
        opposite_reasoning: 'If I am wrong, it is because the sum is not the difference.',
        blind_pct: 55,
        current_pct: 55,
      }),
    ]
    db.groups = []
  })

  it('flag off: the second number never resurfaces, the number on record stands alone', async () => {
    const v = await view({})
    expect(v.my).toMatchObject({
      pct: 55,
      firstPct: 70,
      oppositePct: null,
      oppositeReasoning: null,
      blindStep: 'done',
      submitted: true,
    })
  })

  it('flag on: the second number and its reasoning are the student’s own to see', async () => {
    const v = await view({ considerOpposite: true })
    expect(v.my).toMatchObject({
      pct: 55,
      firstPct: 70,
      oppositePct: 40,
      oppositeReasoning: 'If I am wrong, it is because the sum is not the difference.',
      blindStep: 'done',
    })
  })
})

describe('studentView — Socrates questions (§17.4) are gated on the flag', () => {
  const questions = [
    'What makes the difference the same as the price?',
    'What evidence would change your mind?',
    'Which step in your reasoning are you least sure of?',
  ]

  beforeEach(() => {
    db.questions = [questionRow({ phase: 'structured', phase_ends_at: '2026-09-20T10:01:30.000Z' })]
    db.participants = [participantRow(P1, 'Ada'), participantRow(P2, 'Ben'), participantRow(P3, 'Cy')]
    db.submissions = [submissionRow({ participant_id: P1 })]
    db.groups = [groupRow({ socratic_questions: questions })]
  })

  it('flag off: the group is there but carries no questions', async () => {
    const v = await view({})
    expect(v.group?.turnOrder).toEqual(['Ada', 'Ben', 'Cy'])
    expect(v.group?.socratesQuestions).toBeNull()
  })

  it('flag on: the own group’s questions arrive one per speaker', async () => {
    const v = await view({ socrates: true })
    expect(v.group?.socratesQuestions).toEqual(questions)
  })

  it('flag on, nothing prepared yet: null, not an empty list', async () => {
    db.groups = [groupRow({ socratic_questions: null })]
    const v = await view({ socrates: true })
    expect(v.group?.socratesQuestions).toBeNull()
  })
})
