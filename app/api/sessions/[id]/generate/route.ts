import { dbCache } from '@/lib/agents/cache'
import { generateQuestions } from '@/lib/agents/generator'
import { requireTeacher } from '@/lib/auth'
import { db } from '@/lib/db/server'
import { json, parseBody, withErrors } from '@/lib/http'
import { GenerateBody, type CandidatesResult } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/sessions/:id/generate — question generator (P1 / plan §17.3):
 * five candidate propositions from a topic. Nothing is inserted; the
 * teacher edits and confirms each one. A fallback is the canned list,
 * flagged so the UI can say it is not topic-specific.
 */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  await requireTeacher(client, id, request)
  const body = await parseBody(GenerateBody, request)

  const result = await generateQuestions({ kind: 'topic', topic: body.topic }, { cache: dbCache(client) })
  const response: CandidatesResult = { ok: true, fallback: result.fallback, candidates: result.output.candidates }
  return json(response)
})
