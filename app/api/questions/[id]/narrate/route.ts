import { assertTeacher, requireQuestion } from '@/lib/auth'
import { db } from '@/lib/db/server'
import { jsonError, withErrors } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Ctx = { params: Promise<{ id: string }> }

/** GET /api/questions/:id/narrate — P1: narrator agent. Not built yet. */
export const GET = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const { session } = await requireQuestion(db(), id)
  assertTeacher(session, request)
  return jsonError(501, 'not_implemented', 'P1: narrator is not built yet')
})
