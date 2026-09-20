import { requireTeacher } from '@/lib/auth'
import { bumpTick, insertQuestions } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import { json, parseBody, withErrors } from '@/lib/http'
import { AddQuestionsBody, type AddQuestionsResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** POST /api/sessions/:id/questions — teacher appends questions (STEM ones carry their answer). */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const session = await requireTeacher(client, id, request)
  const body = await parseBody(AddQuestionsBody, request)

  const rows = await insertQuestions(
    client,
    session.id,
    body.questions.map((qi) => ({
      proposition: qi.proposition,
      mode: qi.mode,
      // Humanities questions never resolve, so they never carry an answer.
      correct_answer: qi.mode === 'stem' ? (qi.correctAnswer ?? null) : null,
    })),
  )
  await bumpTick(client, session.id)
  const result: AddQuestionsResult = { questions: rows.map((r) => ({ id: r.id, index: r.order_index })) }
  return json(result, { status: 201 })
})
