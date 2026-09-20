import { dbCache } from '@/lib/agents/cache'
import { clusterReasons, MIN_REASONS_TO_CLUSTER } from '@/lib/agents/clusterer'
import { assertTeacher, requireQuestion } from '@/lib/auth'
import { bumpTick, listSubmissions, replaceClusters, upsertSubmissionPatches } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import { HttpError, json, withErrors } from '@/lib/http'
import { phaseAtLeast } from '@/lib/views/common'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/questions/:id/cluster — run the argument clusterer (out of band;
 * the dashboard calls this when it first sees the snapshot phase). Replaces
 * any existing clusters for the question. Skips when fewer than three
 * students wrote a reason.
 */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  assertTeacher(session, request)
  if (!phaseAtLeast(question.phase, 'snapshot')) {
    throw new HttpError(409, 'too_early', 'Clusters are computed from the snapshot phase on')
  }

  const submissions = await listSubmissions(client, question.id)
  const withText = submissions.filter((s) => (s.reasoning ?? '').trim().length > 0)
  if (withText.length < MIN_REASONS_TO_CLUSTER) {
    return json({ ok: true, skipped: true, fallback: false, clusters: [] })
  }

  const result = await clusterReasons(
    {
      proposition: question.proposition,
      reasons: withText.map((s, i) => ({ i, text: (s.reasoning ?? '').trim() })),
    },
    { cache: dbCache(client) },
  )

  const clusters = result.output.clusters.map((c, idx) => ({
    idx,
    label: c.label,
    member_ids: c.members
      .map((i) => withText[i]?.participant_id)
      .filter((pid): pid is string => typeof pid === 'string'),
  }))

  await replaceClusters(client, question.id, clusters)
  await upsertSubmissionPatches(
    client,
    question.id,
    clusters.flatMap((c) => c.member_ids.map((participantId) => ({ participantId, patch: { cluster_index: c.idx } }))),
  )
  await bumpTick(client, session.id)

  return json({
    ok: true,
    skipped: false,
    fallback: result.fallback,
    clusters: clusters.map((c) => ({ index: c.idx, label: c.label, count: c.member_ids.length })),
  })
})
