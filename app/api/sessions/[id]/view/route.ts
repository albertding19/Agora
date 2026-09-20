import { z } from 'zod'
import { requireParticipant, requireSession } from '@/lib/auth'
import { db } from '@/lib/db/server'
import { HttpError, json, withErrors } from '@/lib/http'
import { buildStudentView } from '@/lib/views/studentView'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** GET /api/sessions/:id/view?participantId= — the student's view model (also runs the lazy timer). */
export const GET = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const participantId = new URL(request.url).searchParams.get('participantId')
  if (!participantId || !z.uuid().safeParse(participantId).success) {
    throw new HttpError(400, 'missing_participant', 'participantId query parameter is required')
  }
  const client = db()
  const session = await requireSession(client, id)
  const participant = await requireParticipant(client, session.id, participantId)
  const view = await buildStudentView(client, session, participant, new Date())
  return json(view, { headers: { 'Cache-Control': 'no-store' } })
})
