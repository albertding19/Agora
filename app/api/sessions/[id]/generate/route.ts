import { requireTeacher } from '@/lib/auth'
import { db } from '@/lib/db/server'
import { jsonError, withErrors } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Ctx = { params: Promise<{ id: string }> }

/** POST /api/sessions/:id/generate — P1: question generator agent. Not built yet. */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  await requireTeacher(db(), id, request)
  return jsonError(501, 'not_implemented', 'P1: question generator is not built yet')
})
