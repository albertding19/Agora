import { requireParticipant, requireQuestion } from '@/lib/auth'
import { bumpTick, insertArgumentVote, listSubmissions } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import { featuresOf } from '@/lib/features'
import { HttpError, json, parseBody, withErrors } from '@/lib/http'
import { isOpenQuestion } from '@/lib/phases/machine'
import { ArgumentVoteBody, type ArgumentVoteResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/questions/:id/argument-vote — argument Elo (plan §17.9b): one
 * pairwise comparison of two anonymous arguments after resolution. Both
 * ids must be submissions of this question with a written reason, and
 * neither may be the voter's own. An open question (§17.3) has no arguments
 * to compare, so it is refused like a disabled flag. A repeat of a pair
 * already compared by this voter (either order) writes nothing and returns
 * `counted: false`.
 */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  const body = await parseBody(ArgumentVoteBody, request)
  await requireParticipant(client, session.id, body.participantId)
  if (!featuresOf(session.features).argumentElo) {
    throw new HttpError(409, 'feature_disabled', 'Argument comparison is switched off for this session')
  }
  if (isOpenQuestion(question)) {
    throw new HttpError(409, 'open_mode', 'Open questions have no arguments to compare')
  }
  if (question.phase !== 'resolved') {
    throw new HttpError(409, 'not_resolved', 'Arguments are compared once the question is resolved')
  }

  const submissions = await listSubmissions(client, question.id)
  const argumentsById = new Map(
    submissions.filter((s) => (s.reasoning ?? '').trim().length > 0).map((s) => [s.id, s] as const),
  )
  const winner = argumentsById.get(body.winnerSubmissionId)
  const loser = argumentsById.get(body.loserSubmissionId)
  if (!winner || !loser) {
    throw new HttpError(404, 'argument_not_found', 'One of those arguments is not part of this question')
  }
  if (winner.participant_id === body.participantId || loser.participant_id === body.participantId) {
    throw new HttpError(409, 'own_argument', 'You cannot compare your own argument')
  }

  const counted = await insertArgumentVote(client, {
    question_id: question.id,
    voter_id: body.participantId,
    winner_submission_id: body.winnerSubmissionId,
    loser_submission_id: body.loserSubmissionId,
  })
  if (counted) await bumpTick(client, session.id)

  const result: ArgumentVoteResult = { ok: true, counted }
  return json(result)
})
