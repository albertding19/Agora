import { requireTeacher } from '@/lib/auth'
import { db } from '@/lib/db/server'
import { json, parseBody, withErrors } from '@/lib/http'
import { startQuestion } from '@/lib/phases/advance'
import { StartBody } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** POST /api/sessions/:id/start — teacher starts a question (pending → blind). */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const session = await requireTeacher(client, id, request)
  const body = await parseBody(StartBody, request)
  const question = await startQuestion(client, session, body.questionId, new Date())
  return json({ ok: true, question: { id: question.id, phase: question.phase, phaseEndsAt: question.phase_ends_at } })
})
