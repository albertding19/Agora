import { dbCache } from '@/lib/agents/cache'
import { askSocrates, type SocratesSpeaker } from '@/lib/agents/socrates'
import { assertTeacher, requireQuestion } from '@/lib/auth'
import { bumpTick, listGroups, listSubmissions, setGroupSocraticQuestions } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import type { GroupRow, SubmissionRow } from '@/lib/db/types'
import { HttpError, json, withErrors } from '@/lib/http'
import { isOpenQuestion } from '@/lib/phases/machine'
import type { SocratesResult } from '@/lib/types'
import { phaseAtLeast } from '@/lib/views/common'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Ctx = { params: Promise<{ id: string }> }

/** One question per speaker, in turn order, is what "ready" means (teacherView agrees). */
function hasQuestions(g: GroupRow): boolean {
  return (g.socratic_questions?.length ?? 0) === g.turn_order.length
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/** Speakers in turn order: turn numbers, leans and reasons, never a name or id. */
function speakersOf(g: GroupRow, byParticipant: Map<string, SubmissionRow>): SocratesSpeaker[] {
  return g.turn_order.map((pid, i) => {
    const sub = byParticipant.get(pid)
    return { turn: i + 1, leanPct: sub?.blind_pct ?? null, reasoning: (sub?.reasoning ?? '').trim() || null }
  })
}

/** How many composition passes a run makes: one, plus one for groups regrouped under the first. */
const MAX_PASSES = 2

/**
 * POST /api/questions/:id/socrates — Socrates agent (plan §17.4): one
 * structured call per group, in parallel, producing one question per
 * speaker in turn order. Out of band: the dashboard calls this at snapshot
 * (or the teacher clicks). The agent sees turn numbers, leans and reasons,
 * never a name or id.
 *
 * Idempotent: a group that already has one question per speaker is left
 * alone, so two dashboard tabs auto-triggering at the same snapshot, or a
 * click during a run, never replace a set the phones may already be reading.
 * Regroup-safe: the questions are composed per turn order, and a snapshot
 * recompute during the model call regroups and clears the column, so the
 * groups are re-read after the calls and a group whose order changed gets
 * nothing from this pass — a question composed for the old order must not
 * land on the new one. Such groups are composed once more from their fresh
 * order; any still regrouped after that are reported in `stale` and stay
 * 'none' on the dashboard, where Prepare Socrates can be pressed again.
 */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  assertTeacher(session, request)
  if (!phaseAtLeast(question.phase, 'snapshot')) {
    throw new HttpError(409, 'too_early', 'Socrates needs the groups, which exist from the snapshot phase on')
  }

  const skipped: SocratesResult = { ok: true, skipped: true, fallbackCount: 0, stale: 0, groups: [] }
  if (isOpenQuestion(question)) return json(skipped)
  let groups = await listGroups(client, question.id)
  if (groups.length === 0) return json(skipped)

  const submissions = await listSubmissions(client, question.id)
  const byParticipant = new Map(submissions.map((s) => [s.participant_id, s]))
  const cache = dbCache(client)

  // Group id → the questions this run wrote. A group is pending when the
  // freshest read shows no complete set and this run has not written one.
  const written = new Map<string, string[]>()
  const questionsOf = (g: GroupRow): string[] => written.get(g.id) ?? (hasQuestions(g) ? (g.socratic_questions ?? []) : [])
  let fallbackCount = 0

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const pending = groups.filter((g) => questionsOf(g).length === 0)
    if (pending.length === 0) break
    const results = await Promise.all(
      pending.map((g) => askSocrates({ proposition: question.proposition, speakers: speakersOf(g, byParticipant) }, { cache })),
    )
    groups = await listGroups(client, question.id)
    const fresh = new Map(groups.map((g) => [g.id, g]))
    const writes: { id: string; questions: string[]; fallback: boolean }[] = []
    pending.forEach((g, i) => {
      const now = fresh.get(g.id)
      if (now && sameOrder(now.turn_order, g.turn_order)) {
        writes.push({ id: g.id, questions: results[i].output.questions, fallback: results[i].fallback })
      }
    })
    await Promise.all(writes.map((w) => setGroupSocraticQuestions(client, w.id, w.questions)))
    for (const w of writes) {
      written.set(w.id, w.questions)
      if (w.fallback) fallbackCount += 1
    }
  }
  await bumpTick(client, session.id)

  const result: SocratesResult = {
    ok: true,
    skipped: false,
    fallbackCount,
    stale: groups.filter((g) => questionsOf(g).length === 0).length,
    groups: groups.map((g) => ({ index: g.idx, questions: questionsOf(g) })),
  }
  return json(result)
})
