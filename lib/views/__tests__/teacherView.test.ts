/**
 * Teacher view: Socrates readiness, the Socrates flag gate, and the
 * argument-Elo voter rate. The database is a mocked query module; the lazy
 * phase timer is stubbed. Every built view is re-parsed through the
 * `TeacherView` contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ArgumentVoteRow, GroupRow, ParticipantRow, QuestionRow, SubmissionRow } from '@/lib/db/types'
import { TeacherView } from '@/lib/types'
import { buildTeacherView } from '@/lib/views/teacherView'
import {
  NOW,
  P1,
  P2,
  P3,
  P4,
  P5,
  P6,
  groupRow,
  participantRow,
  questionRow,
  sessionRow,
  submissionRow,
  voteRow,
} from './fixtures'

const db = vi.hoisted(() => ({
  questions: [] as QuestionRow[],
  participants: [] as ParticipantRow[],
  submissions: [] as SubmissionRow[],
  groups: [] as GroupRow[],
  votes: [] as ArgumentVoteRow[],
}))

vi.mock('@/lib/db/queries', () => ({
  listQuestions: async () => db.questions,
  listParticipants: async () => db.participants,
  listSubmissions: async () => db.submissions,
  listSubmissionsForQuestions: async () => [],
  listGroups: async () => db.groups,
  listClusters: async () => [],
  listClustersForQuestions: async () => [],
  listTrades: async () => [],
  listArgumentVotes: async () => db.votes,
  getTickVersion: async () => 0,
}))

vi.mock('@/lib/phases/advance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/phases/advance')>()
  return { ...actual, maybeAdvance: async (_c: unknown, _s: unknown, question: QuestionRow) => question }
})

const client = {} as SupabaseClient

async function current(features: Record<string, boolean> = {}) {
  const v = TeacherView.parse(await buildTeacherView(client, sessionRow({ features }), NOW))
  if (!v.current) throw new Error('expected a current question')
  return v.current
}

const six = () => [
  participantRow(P1, 'Ada'),
  participantRow(P2, 'Ben'),
  participantRow(P3, 'Cy'),
  participantRow(P4, 'Di'),
  participantRow(P5, 'Ed'),
  participantRow(P6, 'Flo'),
]
const q3 = ['What would have to be true?', 'What evidence would change your mind?', 'Which step are you least sure of?']
const g0 = (over: Partial<GroupRow> = {}) => groupRow({ idx: 0, turn_order: [P1, P2, P3], ...over })
const g1 = (over: Partial<GroupRow> = {}) =>
  groupRow({ id: '00000000-0000-4000-8000-000000000202', idx: 1, turn_order: [P4, P5, P6], ...over })

describe('teacherView — socraticStatus (§17.4)', () => {
  beforeEach(() => {
    db.questions = [questionRow({ phase: 'structured', phase_ends_at: '2026-09-20T10:01:30.000Z' })]
    db.participants = six()
    db.submissions = [submissionRow({ participant_id: P1 })]
    db.votes = []
  })

  it('is ready only once every group has one question per speaker', async () => {
    db.groups = [g0({ socratic_questions: q3 }), g1({ socratic_questions: q3 })]
    expect((await current({ socrates: true })).socraticStatus).toBe('ready')
  })

  it('a partial write (one group still empty) stays none, so the button re-enables', async () => {
    db.groups = [g0({ socratic_questions: q3 }), g1({ socratic_questions: null })]
    expect((await current({ socrates: true })).socraticStatus).toBe('none')
  })

  it('a group with fewer questions than speakers is not ready', async () => {
    db.groups = [g0({ socratic_questions: q3 }), g1({ socratic_questions: q3.slice(0, 2) })]
    expect((await current({ socrates: true })).socraticStatus).toBe('none')
  })

  it('is skipped from snapshot on when there are no groups', async () => {
    db.questions = [questionRow({ phase: 'snapshot' })]
    db.groups = []
    expect((await current({ socrates: true })).socraticStatus).toBe('skipped')
  })

  it('is skipped for an open question', async () => {
    db.questions = [questionRow({ phase: 'snapshot', mode: 'open', correct_answer: null, blind_price_pct: null })]
    db.groups = []
    expect((await current({ socrates: true })).socraticStatus).toBe('skipped')
  })

  it('is none during blind (groups do not exist yet)', async () => {
    db.questions = [questionRow({ phase: 'blind', phase_ends_at: '2026-09-20T10:01:15.000Z', blind_price_pct: null })]
    db.groups = []
    expect((await current({ socrates: true })).socraticStatus).toBe('none')
  })
})

describe('teacherView — groups[].socratesQuestions is gated on the flag (§17.4)', () => {
  beforeEach(() => {
    db.questions = [questionRow({ phase: 'structured', phase_ends_at: '2026-09-20T10:01:30.000Z' })]
    db.participants = six()
    db.submissions = [submissionRow({ participant_id: P1 })]
    db.groups = [g0({ socratic_questions: q3 }), g1({ socratic_questions: q3 })]
    db.votes = []
  })

  it('flag off: every group carries null', async () => {
    const cur = await current({})
    expect(cur.groups).toHaveLength(2)
    expect(cur.groups.map((g) => g.socratesQuestions)).toEqual([null, null])
  })

  it('flag on: every group carries its questions in turn order', async () => {
    const cur = await current({ socrates: true })
    expect(cur.groups.map((g) => g.socratesQuestions)).toEqual([q3, q3])
  })
})

describe('teacherView — argumentVotersPct and topArguments (§17.9b)', () => {
  const resolved = () =>
    questionRow({
      phase: 'resolved',
      post_price_pct: 60,
      phase_log: [
        { phase: 'blind', at: '2026-09-20T09:58:00.000Z' },
        { phase: 'snapshot', at: '2026-09-20T09:59:00.000Z' },
        { phase: 'structured', at: '2026-09-20T09:59:10.000Z' },
        { phase: 'open', at: '2026-09-20T09:59:40.000Z' },
        { phase: 'resolved', at: '2026-09-20T10:00:00.000Z' },
      ],
    })

  beforeEach(() => {
    db.questions = [resolved()]
    db.participants = [participantRow(P1, 'Ada'), participantRow(P2, 'Ben'), participantRow(P3, 'Cy')]
    db.submissions = [
      submissionRow({ participant_id: P1, reasoning: 'It is 10 cents because 1.10 minus 1.00.' }),
      submissionRow({ participant_id: P2, reasoning: 'Ten cents would make the bat only 90 cents more.', blind_pct: 20, current_pct: 20 }),
      submissionRow({ participant_id: P3, reasoning: null }),
    ]
    db.groups = []
    db.votes = []
  })

  it('flag on at resolved with no comparisons yet: 0 percent, not null, and no ranking', async () => {
    const cur = await current({ argumentElo: true })
    expect(cur.argumentVotersPct).toBe(0)
    expect(cur.topArguments).toEqual([])
  })

  it('flag off: null, and nothing ranked', async () => {
    db.votes = [voteRow(P3, db.submissions[1].id, db.submissions[0].id)]
    const cur = await current({})
    expect(cur.argumentVotersPct).toBeNull()
    expect(cur.topArguments).toEqual([])
  })

  it('flag on before resolution: null (the duel has not started)', async () => {
    db.questions = [questionRow({ phase: 'open', phase_ends_at: '2026-09-20T10:01:00.000Z' })]
    const cur = await current({ argumentElo: true })
    expect(cur.argumentVotersPct).toBeNull()
  })

  it('flag on with one voter of three: a percentage of the class and a ranking, never a tally of voters', async () => {
    db.votes = [voteRow(P3, db.submissions[1].id, db.submissions[0].id)]
    const cur = await current({ argumentElo: true })
    expect(cur.argumentVotersPct).toBeCloseTo(33.3, 1)
    expect(cur.topArguments.map((a) => a.text)).toEqual([
      'Ten cents would make the bat only 90 cents more.',
      'It is 10 cents because 1.10 minus 1.00.',
    ])
    expect(cur.topArguments[0].side).toBe('FALSE')
    expect(cur.topArguments[0].winPct).toBeGreaterThan(cur.topArguments[1].winPct)
  })

  it('takes an argument\'s side from the first number, not a consider-the-opposite blend sitting at 50', async () => {
    // Ben argued FALSE at 20, then gave 80 as the opposite: the blend is 50,
    // which leans neither way, but the reason he wrote argued FALSE.
    db.submissions[1] = submissionRow({
      participant_id: P2,
      reasoning: 'Ten cents would make the bat only 90 cents more.',
      first_pct: 20,
      opposite_pct: 80,
      blind_pct: 50,
      current_pct: 50,
    })
    db.votes = [voteRow(P3, db.submissions[1].id, db.submissions[0].id)]
    const cur = await current({ argumentElo: true, considerOpposite: true })
    expect(cur.topArguments[0].text).toBe('Ten cents would make the bat only 90 cents more.')
    expect(cur.topArguments[0].side).toBe('FALSE')
    // A row that predates the first number falls back to the blind number.
    db.submissions[1] = submissionRow({ participant_id: P2, reasoning: 'Ten cents would make the bat only 90 cents more.', first_pct: null, blind_pct: 20, current_pct: 20 })
    db.votes = [voteRow(P3, db.submissions[1].id, db.submissions[0].id)]
    expect((await current({ argumentElo: true })).topArguments[0].side).toBe('FALSE')
  })
})
