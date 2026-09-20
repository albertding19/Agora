import { requireTeacher } from '@/lib/auth'
import { db } from '@/lib/db/server'
import { json, withErrors } from '@/lib/http'
import { buildTeacherView } from '@/lib/views/teacherView'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** GET /api/sessions/:id/teacher-view — dashboard and projector view model (also runs the lazy timer). */
export const GET = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const session = await requireTeacher(client, id, request)
  const view = await buildTeacherView(client, session, new Date())
  return json(view, { headers: { 'Cache-Control': 'no-store' } })
})
