import { db } from '@/lib/db/server'
import { insertSession, insertTick } from '@/lib/db/queries'
import { HttpError, json, parseBody, withErrors } from '@/lib/http'
import { newSessionCode, newToken } from '@/lib/ids'
import { DEFAULT_BUDGET, DEFAULT_K } from '@/lib/market/lmsr'
import { CreateSessionBody, type CreateSessionResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

const DEFAULT_TIMERS = { blindSeconds: 75, turnSeconds: 30, openSeconds: 60 }
const CODE_ATTEMPTS = 5

/** POST /api/sessions — teacher creates a session and receives the join code and their token. */
export const POST = withErrors(async (request: Request) => {
  const body = await parseBody(CreateSessionBody, request)
  const client = db()
  const teacherToken = newToken()
  const timers = { ...DEFAULT_TIMERS, ...(body.timers ?? {}) }

  let session = null
  for (let attempt = 0; attempt < CODE_ATTEMPTS && !session; attempt++) {
    session = await insertSession(client, {
      code: newSessionCode(),
      title: body.title,
      teacher_token: teacherToken,
      budget: body.budget ?? DEFAULT_BUDGET,
      k: body.k ?? DEFAULT_K,
      blind_seconds: timers.blindSeconds,
      turn_seconds: timers.turnSeconds,
      open_seconds: timers.openSeconds,
    })
  }
  if (!session) throw new HttpError(500, 'code_collision', 'Could not allocate a unique session code')

  await insertTick(client, session.id)
  const result: CreateSessionResult = { sessionId: session.id, code: session.code, teacherToken }
  return json(result, { status: 201 })
})
