import { dbCache } from '@/lib/agents/cache'
import { askSocrates, type SocratesSpeaker } from '@/lib/agents/socrates'
import { assertTeacher, requireQuestion } from '@/lib/auth'
import { bumpTick, listGroups, listSubmissions, setGroupSocraticQuestions } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import { HttpError, json, withErrors } from '@/lib/http'
import { isOpenQuestion } from '@/lib/phases/machine'
import type { SocratesResult } from '@/lib/types'
import { phaseAtLeast } from '@/lib/views/common'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/questions/:id/socrates — Socrates agent (plan §17.4): one
 * structured call per group, in parallel, producing one question per
 * speaker in turn order. Out of band: the dashboard calls this at snapshot
 * (or the teacher clicks). Re-running overwrites; cache hits make it free.
 * The agent sees turn numbers, leans and reasons, never a name or id.
 */
export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const { question, session } = await requireQuestion(client, id)
  assertTeacher(session, request)
  if (!phaseAtLeast(question.phase, 'snapshot')) {
    throw new HttpError(409, 'too_early', 'Socrates needs the groups, which exist from the snapshot phase on')
  }

  const skipped: SocratesResult = { ok: true, skipped: true, fallbackCount: 0, groups: [] }
  if (isOpenQuestion(question)) return json(skipped)
  const groups = await listGroups(client, question.id)
  if (groups.length === 0) return json(skipped)

  const submissions = await listSubmissions(client, question.id)
  const byParticipant = new Map(submissions.map((s) => [s.participant_id, s]))
  const cache = dbCache(client)

  const results = await Promise.all(
    groups.map((g) => {
      const speakers: SocratesSpeaker[] = g.turn_order.map((pid, i) => {
        const sub = byParticipant.get(pid)
        return { turn: i + 1, leanPct: sub?.blind_pct ?? null, reasoning: (sub?.reasoning ?? '').trim() || null }
      })
      return askSocrates({ proposition: question.proposition, speakers }, { cache })
    }),
  )
  await Promise.all(groups.map((g, i) => setGroupSocraticQuestions(client, g.id, results[i].output.questions)))
  await bumpTick(client, session.id)

  const result: SocratesResult = {
    ok: true,
    skipped: false,
    fallbackCount: results.filter((r) => r.fallback).length,
    groups: groups.map((g, i) => ({ index: g.idx, questions: results[i].output.questions })),
  }
  return json(result)
})
