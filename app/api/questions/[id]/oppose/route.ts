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
import { questionLiquidity, toStates } from '@/lib/phases/advance'
import { blindPricePct, isOpenQuestion } from '@/lib/phases/machine'
import { blendPct } from '@/lib/scoring/blend'
import { OpposeBody, type OpposeResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/questions/:id/oppose — consider the opposite (plan §17.1). The
 * student assumes their first number is wrong and gives a second one; the
 * blind number the engine reads becomes the blend of the two. Gated
 * server-side because it changes the market input. Leaves
 * `blind_submitted_at` alone: the first number is what counts as submitting.
 *
 * On a cascade question (§17.5) the blind price is visible while phones
 * submit and its history is the blind trades, so the second number's move
 * is logged as a blind-phase trade exactly as `submit` logs the first one;
 * otherwise the arc, the replay and `GET …/history` would miss a move the
 * projector showed. Non-cascade questions keep the single upsert.
 */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  const body = await parseBody(OpposeBody, request)
  await requireParticipant(client, session.id, body.participantId)
  if (question.phase !== 'blind') {
    throw new HttpError(409, 'not_in_blind_phase', 'The blind phase is over')
  }
  if (!featuresOf(session.features).considerOpposite) {
    throw new HttpError(409, 'feature_disabled', 'Consider the opposite is switched off for this session')
  }
  if (isOpenQuestion(question)) {
    throw new HttpError(409, 'open_mode', 'Open questions take a written answer, not a number')
  }

  const cascade = question.cascade_mode

  // A row can exist from `propose` without a number, so check the number, not
  // the row. On a cascade question the row comes from the same read that
  // prices the class before the change, so `pct_before` and the price before
  // agree (as in `submit`).
  let existing: SubmissionRow | null = null
  let before: SubmissionRow[] = []
  let b = 0
  if (cascade) {
    const participants = await listParticipants(client, session.id)
    b = questionLiquidity(question, session, participants.length)
    before = await listSubmissions(client, question.id)
    existing = before.find((s) => s.participant_id === body.participantId) ?? null
  } else {
    existing = await getSubmission(client, question.id, body.participantId)
  }
  const first = existing?.first_pct ?? existing?.blind_pct ?? null
  if (first === null) {
    throw new HttpError(409, 'no_first_number', 'Give your first number before the second one')
  }

  const blind = blendPct(first, body.pct)
  const patch: SubmissionPatch = {
    first_pct: first,
    opposite_pct: body.pct,
    blind_pct: blind,
    current_pct: blind,
  }
  if (body.reasoning !== undefined) patch.opposite_reasoning = body.reasoning
  const result: OpposeResult = { ok: true, blindPct: blind }

  if (!cascade) {
    await upsertSubmission(client, question.id, body.participantId, patch)
    await bumpTick(client, session.id)
    return json(result)
  }

  // Cascade: the consensus is visible while phones submit, so the second
  // number is a logged move of the blind price (mirrors `submit`).
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
  return json(result)
})
