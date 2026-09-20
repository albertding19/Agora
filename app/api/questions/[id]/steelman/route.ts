import { dbCache } from '@/lib/agents/cache'
import { gradeSteelman } from '@/lib/agents/steelman'
import { requireParticipant, requireQuestion } from '@/lib/auth'
import { getSubmission, upsertSubmission } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import { featuresOf } from '@/lib/features'
import { HttpError, json, parseBody, withErrors } from '@/lib/http'
import { isOpenQuestion } from '@/lib/phases/machine'
import { steelmanSideFor } from '@/lib/scoring/steelman'
import { SteelmanBody, type SteelmanResult } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/questions/:id/steelman — steelman gate (plan §17.7). The student
 * writes the other side's best argument; the grader scores its fidelity and
 * the score is stored on the submission. The side is derived from the
 * student's blind number, never stored. Open through snapshot and the
 * structured round; re-submitting overwrites and identical text is a cache
 * hit. Per-student, like `propose`, so no tick.
 */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  const body = await parseBody(SteelmanBody, request)
  await requireParticipant(client, session.id, body.participantId)
  if (!featuresOf(session.features).steelman) {
    throw new HttpError(409, 'feature_off', 'The steelman gate is switched off for this session')
  }
  if (isOpenQuestion(question)) {
    throw new HttpError(409, 'open_mode', 'Open questions have no side to steelman')
  }
  if (question.phase !== 'snapshot' && question.phase !== 'structured') {
    throw new HttpError(409, 'steelman_closed', 'The steelman is written between the blind phase and the open discussion')
  }

  const sub = await getSubmission(client, question.id, body.participantId)
  const side = steelmanSideFor(sub?.blind_pct ?? null)
  const graded = await gradeSteelman(
    { proposition: question.proposition, side, text: body.text },
    { cache: dbCache(client) },
  )
  await upsertSubmission(client, question.id, body.participantId, {
    steelman_text: body.text,
    steelman_score: graded.output.fidelity,
    steelman_note: graded.output.note,
  })

  const result: SteelmanResult = { score: graded.output.fidelity, note: graded.output.note, fallback: graded.fallback }
  return json(result)
})
