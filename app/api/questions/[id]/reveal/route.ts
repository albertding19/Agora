import { assertTeacher, requireQuestion } from '@/lib/auth'
import { db } from '@/lib/db/server'
import { json, withErrors } from '@/lib/http'
import { reveal } from '@/lib/phases/advance'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** POST /api/questions/:id/reveal — show the blind price on the projector and phones (demo step 2). */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  assertTeacher(session, request)
  const updated = await reveal(client, session, question)
  return json({ ok: true, blindRevealed: updated.blind_revealed })
})
