import { dbCache } from '@/lib/agents/cache'
import { generateQuestions, SAMPLES_PER_CLUSTER, type GeneratorCluster } from '@/lib/agents/generator'
import { assertTeacher, requireQuestion } from '@/lib/auth'
import { listClusters, listSubmissions } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import { HttpError, json, withErrors } from '@/lib/http'
import { isOpenQuestion } from '@/lib/phases/machine'
import type { CandidatesResult } from '@/lib/types'
import { phaseAtLeast } from '@/lib/views/common'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/questions/:id/sharpen — open question (plan §17.3): turn the
 * clustered answers into candidate propositions. The agent sees cluster
 * labels, counts and a few sample texts, never a name. Nothing is inserted:
 * the teacher edits and confirms each candidate before it becomes a
 * question. No tick either, so a re-click is just a cache hit.
 */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  assertTeacher(session, request)
  if (!isOpenQuestion(question)) {
    throw new HttpError(409, 'not_open_mode', 'Only an open question can be sharpened into a proposition')
  }
  if (!phaseAtLeast(question.phase, 'snapshot')) {
    throw new HttpError(409, 'too_early', 'End the answers first; sharpening reads the clustered answers')
  }

  const clusters = await listClusters(client, question.id)
  if (clusters.length === 0) {
    throw new HttpError(409, 'no_clusters', 'Run clustering first; it needs at least three answers')
  }
  const submissions = await listSubmissions(client, question.id)

  // Samples are member texts in submission order; texts only, never names.
  const input: GeneratorCluster[] = clusters.map((c) => {
    const members = new Set(c.member_ids)
    const samples = submissions
      .filter((s) => members.has(s.participant_id))
      .map((s) => (s.reasoning ?? '').trim())
      .filter((text) => text.length > 0)
      .slice(0, SAMPLES_PER_CLUSTER)
    return { label: c.label, count: c.member_ids.length, samples }
  })

  const result = await generateQuestions(
    {
      kind: 'cluster',
      question: question.proposition,
      referenceAnswer: question.reference_answer,
      clusters: input,
    },
    { cache: dbCache(client) },
  )

  const response: CandidatesResult = { ok: true, fallback: result.fallback, candidates: result.output.candidates }
  return json(response)
})
