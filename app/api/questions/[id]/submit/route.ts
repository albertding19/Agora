import { requireParticipant, requireQuestion } from '@/lib/auth'
import {
  bumpTick,
  getSubmission,
  insertTrade,
  listParticipants,
  listSubmissions,
  upsertSubmission,
  type SubmissionPatch,
} from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import type { SubmissionRow } from '@/lib/db/types'
import { featuresOf } from '@/lib/features'
import { HttpError, json, parseBody, withErrors } from '@/lib/http'
import { roundPct } from '@/lib/market/lmsr'
import { questionLiquidity, toStates } from '@/lib/phases/advance'
import { blindPricePct, isOpenQuestion } from '@/lib/phases/machine'
import { blendPct } from '@/lib/scoring/blend'
import { SubmitBody } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/questions/:id/submit — blind-phase number (upsert; tapping twice is fine).
 *
 * Extensions (plan §17), each inert unless switched on:
 *   - §17.1 consider the opposite: with the flag on, the number on record is
 *     the blend of this first number and any second number already given, so
 *     changing the first keeps the second. `first_pct` is always written.
 *   - §17.2 predict the class: `predictedTruePct` is stored whenever sent.
 *   - §17.3 open questions take a written answer (POST …/answer), never a number.
 *   - §17.5 cascade questions log the submission as a blind-phase trade
 *     (price before and after over blind numbers) and return the price, like
 *     `revise` does in the open phase. Non-cascade questions keep the P0
 *     body and response.
 */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  const body = await parseBody(SubmitBody, request)
  await requireParticipant(client, session.id, body.participantId)
  if (isOpenQuestion(question)) {
    throw new HttpError(409, 'open_mode', 'Open questions take a written answer, not a number')
  }
  if (question.phase !== 'blind') {
    throw new HttpError(409, 'not_in_blind_phase', 'The blind phase is over')
  }

  const features = featuresOf(session.features)
  const cascade = question.cascade_mode

  // The existing row is only read when something needs it: the kept second
  // number (§17.1) or the trade's `pct_before` (§17.5).
  let existing: SubmissionRow | null = null
  let before: SubmissionRow[] = []
  let b = 0
  if (cascade) {
    const participants = await listParticipants(client, session.id)
    b = questionLiquidity(question, session, participants.length)
    before = await listSubmissions(client, question.id)
    existing = before.find((s) => s.participant_id === body.participantId) ?? null
  } else if (features.considerOpposite) {
    existing = await getSubmission(client, question.id, body.participantId)
  }

  const blind = features.considerOpposite ? blendPct(body.pct, existing?.opposite_pct ?? null) : body.pct

  const patch: SubmissionPatch = {
    first_pct: body.pct,
    blind_pct: blind,
    blind_submitted_at: new Date().toISOString(),
    current_pct: blind,
  }
  if (body.reasoning !== undefined) patch.reasoning = body.reasoning
  if (body.predictedTruePct !== undefined) patch.predicted_true_pct = body.predictedTruePct

  if (!cascade) {
    await upsertSubmission(client, question.id, body.participantId, patch)
    await bumpTick(client, session.id)
    return json({ ok: true })
  }

  // Cascade: the consensus is visible while phones submit, so each
  // submission is a logged move of the blind price (mirrors `revise`).
  const priceBefore = blindPricePct(toStates(before), session.budget, b)
  await upsertSubmission(client, question.id, body.participantId, patch)
  const after = await listSubmissions(client, question.id)
  const priceAfter = blindPricePct(toStates(after), session.budget, b)

  await insertTrade(client, {
    question_id: question.id,
    participant_id: body.participantId,
    phase: 'blind',
    pct_before: existing?.blind_pct ?? null,
    pct_after: blind,
    price_before_pct: priceBefore,
    price_after_pct: priceAfter,
  })
  await bumpTick(client, session.id)
  return json({ ok: true, pricePct: roundPct(priceAfter, 1) })
})
