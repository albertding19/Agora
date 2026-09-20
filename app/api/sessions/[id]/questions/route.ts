import { requireTeacher } from '@/lib/auth'
import { bumpTick, insertQuestions, listQuestions } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import { HttpError, json, parseBody, withErrors } from '@/lib/http'
import { AddQuestionsBody, type AddQuestionsResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** POST /api/sessions/:id/questions — teacher appends questions (STEM ones carry their answer). */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const session = await requireTeacher(client, id, request)
  const body = await parseBody(AddQuestionsBody, request)

  // A sharpened proposition points at the open question it came from (plan
  // §17.3); that source must be one of this session's own questions.
  const sourceIds = new Set(body.questions.flatMap((qi) => (qi.sourceQuestionId ? [qi.sourceQuestionId] : [])))
  if (sourceIds.size > 0) {
    const known = new Set((await listQuestions(client, session.id)).map((r) => r.id))
    for (const sourceId of sourceIds) {
      if (!known.has(sourceId)) {
        throw new HttpError(404, 'source_question_not_found', 'No such source question in this session')
      }
    }
  }

  const rows = await insertQuestions(
    client,
    session.id,
    body.questions.map((qi) => ({
      proposition: qi.proposition,
      mode: qi.mode,
      // Humanities and open questions never resolve, so they never carry an answer.
      correct_answer: qi.mode === 'stem' ? (qi.correctAnswer ?? null) : null,
      // Only an open question has a reference answer (plan §17.3).
      reference_answer: qi.mode === 'open' ? qi.referenceAnswer || null : null,
      source_question_id: qi.sourceQuestionId ?? null,
      // An open question takes written answers, never a number, so it has no
      // consensus to show during blind (plan §17.5): cascade is forced off.
      cascade_mode: qi.mode !== 'open' && (qi.cascade ?? false),
    })),
  )
  await bumpTick(client, session.id)
  const result: AddQuestionsResult = { questions: rows.map((r) => ({ id: r.id, index: r.order_index })) }
  return json(result, { status: 201 })
})
