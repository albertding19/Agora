/**
 * GET /api/health/agents
 *
 * Pre-warms every agent: one real call per agent (cache bypassed, so the
 * structured-output schema is compiled server-side and the function is warm),
 * logged to agent_runs. Hit it at deploy time and 30 minutes before the demo.
 */
import { NextResponse } from 'next/server'
import { dbCache } from '@/lib/agents/cache'
import { clusterReasons } from '@/lib/agents/clusterer'
import { proposeBand } from '@/lib/agents/proposer'
import type { AgentCache } from '@/lib/agents/run'
import { db } from '@/lib/db/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const WARM_PROPOSITION = 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. So the ball costs 10 cents.'

export async function GET() {
  let cache: AgentCache | undefined
  let cacheError: string | null = null
  try {
    cache = dbCache(db())
  } catch (err) {
    cacheError = err instanceof Error ? err.message : 'db unavailable'
  }

  const opts = { cache, bypassCache: true }
  const [proposer, clusterer] = await Promise.all([
    proposeBand({ proposition: WARM_PROPOSITION, reasoning: 'Obviously, 1.10 minus 1.00 is 0.10.' }, opts),
    clusterReasons(
      {
        proposition: WARM_PROPOSITION,
        reasons: [
          { i: 0, text: '1.10 minus 1.00 is 0.10.' },
          { i: 1, text: 'Solve b + (b + 1) = 1.10, so b = 0.05.' },
          { i: 2, text: 'Ten cents, it says a dollar more.' },
        ],
      },
      opts,
    ),
  ])

  const agents = [
    { name: 'proposer', fallback: proposer.fallback, latencyMs: proposer.latencyMs, model: proposer.model, reason: proposer.reason ?? null },
    { name: 'clusterer', fallback: clusterer.fallback, latencyMs: clusterer.latencyMs, model: clusterer.model, reason: clusterer.reason ?? null },
  ]

  return NextResponse.json({ ok: true, cache: cacheError ? { error: cacheError } : { ok: true }, agents })
}
