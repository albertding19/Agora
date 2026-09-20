import { requireParticipant, requireQuestion } from '@/lib/auth'
import { bumpTick, upsertSubmission } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import { HttpError, json, parseBody, withErrors } from '@/lib/http'
import { isOpenQuestion } from '@/lib/phases/machine'
import { AnswerBody, type OkResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/questions/:id/answer — open question (plan §17.3): a free-text
 * answer, stored in `reasoning` so the clusterer reads it unchanged. No
 * number is ever written for an open question (upsert; editing is fine).
 */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  const body = await parseBody(AnswerBody, request)
  await requireParticipant(client, session.id, body.participantId)
  if (!isOpenQuestion(question)) {
    throw new HttpError(409, 'not_open_mode', 'This question takes a number, not a written answer')
  }
  if (question.phase !== 'blind') {
    throw new HttpError(409, 'not_in_blind_phase', 'Answers are closed for this question')
  }

  await upsertSubmission(client, question.id, body.participantId, { reasoning: body.text })
  await bumpTick(client, session.id)
  const result: OkResult = { ok: true }
  return json(result)
})
