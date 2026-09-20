import { assertTeacher, requireQuestion } from '@/lib/auth'
import { db } from '@/lib/db/server'
import { json, parseBody, withErrors } from '@/lib/http'
import { advance } from '@/lib/phases/advance'
import { AdvanceBody } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/questions/:id/advance — teacher moves the question to the next
 * phase. `from` must match the current phase (409 `phase_mismatch` otherwise).
 * Resolving a STEM question needs its answer (409 `answer_required`).
 */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  assertTeacher(session, request)
  const body = await parseBody(AdvanceBody, request)
  const updated = await advance(client, session, question, body.from, new Date(), {
    correctAnswer: body.correctAnswer,
  })
  return json({ ok: true, phase: updated.phase, phaseEndsAt: updated.phase_ends_at })
})
