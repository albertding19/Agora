import { bumpTick, getSessionByCode, insertParticipant } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import { HttpError, json, parseBody, withErrors } from '@/lib/http'
import { normalizeCode } from '@/lib/ids'
import { JoinBody, type JoinResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** POST /api/join — student joins by code and display name. No account. */
export const POST = withErrors(async (request: Request) => {
  const body = await parseBody(JoinBody, request)
  const client = db()
  const session = await getSessionByCode(client, normalizeCode(body.code))
  if (!session) throw new HttpError(404, 'session_not_found', 'No session with that code')
  if (session.status === 'ended') throw new HttpError(409, 'session_ended', 'This session has ended')

  const participant = await insertParticipant(client, session.id, body.displayName)
  await bumpTick(client, session.id)
  const result: JoinResult = { sessionId: session.id, participantId: participant.id }
  return json(result, { status: 201 })
})
