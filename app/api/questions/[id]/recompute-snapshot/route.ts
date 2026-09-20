import { assertTeacher, requireQuestion } from '@/lib/auth'
import { db } from '@/lib/db/server'
import { json, withErrors } from '@/lib/http'
import { recomputeSnapshot } from '@/lib/phases/advance'
import { round1 } from '@/lib/views/common'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** POST /api/questions/:id/recompute-snapshot — teacher recovery; only while in snapshot. */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  assertTeacher(session, request)
  const updated = await recomputeSnapshot(client, session, question)
  return json({ ok: true, blindPricePct: round1(updated.blind_price_pct) })
})
