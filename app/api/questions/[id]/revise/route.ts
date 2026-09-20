import { requireParticipant, requireQuestion } from '@/lib/auth'
import { bumpTick, insertTrade, listParticipants, listSubmissions, upsertSubmission } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import { HttpError, json, parseBody, withErrors } from '@/lib/http'
import { questionLiquidity, toStates } from '@/lib/phases/advance'
import { livePricePct } from '@/lib/phases/machine'
import { ReviseBody } from '@/lib/types'
import { round1 } from '@/lib/views/common'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/questions/:id/revise — open-phase revision. The price is a pure
 * function of every student's current number, so this just updates the
 * number and logs the price before/after as a trade for the history line.
 * A student who never submitted in blind may still set a number here.
 */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  const body = await parseBody(ReviseBody, request)
  await requireParticipant(client, session.id, body.participantId)
  if (question.phase !== 'open') {
    throw new HttpError(409, 'not_in_open_phase', 'Numbers can only be revised during the open phase')
  }

  const participants = await listParticipants(client, session.id)
  const b = questionLiquidity(question, session, participants.length)

  const before = await listSubmissions(client, question.id)
  const existing = before.find((s) => s.participant_id === body.participantId) ?? null
  const priceBefore = livePricePct(toStates(before), session.budget, b)

  await upsertSubmission(client, question.id, body.participantId, { current_pct: body.pct })

  const after = await listSubmissions(client, question.id)
  const priceAfter = livePricePct(toStates(after), session.budget, b)

  await insertTrade(client, {
    question_id: question.id,
    participant_id: body.participantId,
    phase: 'open',
    pct_before: existing ? (existing.current_pct ?? existing.blind_pct) : null,
    pct_after: body.pct,
    price_before_pct: priceBefore,
    price_after_pct: priceAfter,
  })
  await bumpTick(client, session.id)
  return json({ ok: true, pricePct: round1(priceAfter) })
})
