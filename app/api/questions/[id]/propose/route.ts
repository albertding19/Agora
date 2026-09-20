import { dbCache } from '@/lib/agents/cache'
import { proposeBand } from '@/lib/agents/proposer'
import { requireParticipant, requireQuestion } from '@/lib/auth'
import { upsertSubmission } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import { HttpError, json, parseBody, withErrors } from '@/lib/http'
import { isOpenQuestion } from '@/lib/phases/machine'
import { ProposeBody, type ProposeResult } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/questions/:id/propose — the confidence proposer reads the
 * student's sentence and proposes a band. The student owns the final number;
 * this only stores the proposal alongside their reasoning.
 */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  const body = await parseBody(ProposeBody, request)
  await requireParticipant(client, session.id, body.participantId)
  if (isOpenQuestion(question)) {
    throw new HttpError(409, 'open_mode', 'Open questions take a written answer; there is no number to propose')
  }
  if (question.phase !== 'blind') {
    throw new HttpError(409, 'not_in_blind_phase', 'Reasoning can only be read during the blind phase')
  }

  const result = await proposeBand(
    { proposition: question.proposition, reasoning: body.reasoning },
    { cache: dbCache(client) },
  )
  const band = result.output
  await upsertSubmission(client, question.id, body.participantId, {
    reasoning: body.reasoning,
    ai_stance: band.stance,
    ai_band_lo: band.lo,
    ai_band_hi: band.hi,
    ai_reading: band.reading,
  })

  const response: ProposeResult = { ...band, fallback: result.fallback }
  return json(response)
})
