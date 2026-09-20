import { assertTeacher, requireQuestion } from '@/lib/auth'
import { db } from '@/lib/db/server'
import { json, withErrors } from '@/lib/http'
import { buildQuestionHistory } from '@/lib/views/questionHistory'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/questions/:id/history — the price trajectory with anonymous
 * annotations (plan §17.6 arc, §17.8 replay). Teacher only. A read of a
 * question that may be long past, so no lazy advance here; the polled
 * views own the clock.
 */
export const GET = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  assertTeacher(session, request)
  return json(await buildQuestionHistory(client, question))
})
