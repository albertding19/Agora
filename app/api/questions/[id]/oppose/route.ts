import { requireParticipant, requireQuestion } from '@/lib/auth'
import { bumpTick, getSubmission, upsertSubmission, type SubmissionPatch } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import { featuresOf } from '@/lib/features'
import { HttpError, json, parseBody, withErrors } from '@/lib/http'
import { isOpenQuestion } from '@/lib/phases/machine'
import { blendPct } from '@/lib/scoring/blend'
import { OpposeBody, type OpposeResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/questions/:id/oppose — consider the opposite (plan §17.1). The
 * student assumes their first number is wrong and gives a second one; the
 * blind number the engine reads becomes the blend of the two. Gated
 * server-side because it changes the market input. Leaves
 * `blind_submitted_at` alone: the first number is what counts as submitting.
 */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  const body = await parseBody(OpposeBody, request)
  await requireParticipant(client, session.id, body.participantId)
  if (question.phase !== 'blind') {
    throw new HttpError(409, 'not_in_blind_phase', 'The blind phase is over')
  }
  if (!featuresOf(session.features).considerOpposite) {
    throw new HttpError(409, 'feature_disabled', 'Consider the opposite is switched off for this session')
  }
  if (isOpenQuestion(question)) {
    throw new HttpError(409, 'open_mode', 'Open questions take a written answer, not a number')
  }

  // A row can exist from `propose` without a number, so check the number, not the row.
  const existing = await getSubmission(client, question.id, body.participantId)
  const first = existing?.first_pct ?? existing?.blind_pct ?? null
  if (first === null) {
    throw new HttpError(409, 'no_first_number', 'Give your first number before the second one')
  }

  const blind = blendPct(first, body.pct)
  const patch: SubmissionPatch = {
    first_pct: first,
    opposite_pct: body.pct,
    blind_pct: blind,
    current_pct: blind,
  }
  if (body.reasoning !== undefined) patch.opposite_reasoning = body.reasoning
  await upsertSubmission(client, question.id, body.participantId, patch)
  await bumpTick(client, session.id)

  const result: OpposeResult = { ok: true, blindPct: blind }
  return json(result)
})
