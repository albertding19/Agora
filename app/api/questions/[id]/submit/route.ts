import { requireParticipant, requireQuestion } from '@/lib/auth'
import { bumpTick, upsertSubmission, type SubmissionPatch } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import { HttpError, json, parseBody, withErrors } from '@/lib/http'
import { SubmitBody } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** POST /api/questions/:id/submit — blind-phase number (upsert; tapping twice is fine). */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  const body = await parseBody(SubmitBody, request)
  await requireParticipant(client, session.id, body.participantId)
  if (question.phase !== 'blind') {
    throw new HttpError(409, 'not_in_blind_phase', 'The blind phase is over')
  }

  const patch: SubmissionPatch = {
    blind_pct: body.pct,
    blind_submitted_at: new Date().toISOString(),
    current_pct: body.pct,
  }
  if (body.reasoning !== undefined) patch.reasoning = body.reasoning
  await upsertSubmission(client, question.id, body.participantId, patch)
  await bumpTick(client, session.id)
  return json({ ok: true })
})
