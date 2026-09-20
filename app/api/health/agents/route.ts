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
import { generateQuestions } from '@/lib/agents/generator'
import { proposeBand } from '@/lib/agents/proposer'
import type { AgentCache } from '@/lib/agents/run'
import { askSocrates } from '@/lib/agents/socrates'
import { gradeSteelman } from '@/lib/agents/steelman'
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
  const [proposer, clusterer, generator, socrates, steelman] = await Promise.all([
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
    generateQuestions(
      {
        kind: 'cluster',
        question: 'What causes the seasons?',
        referenceAnswer: "The tilt of Earth's axis.",
        clusters: [
          { label: 'Earth is closer to the sun in summer', count: 12, samples: ['We are closer in summer so it is hotter.'] },
          { label: 'Axial tilt', count: 7, samples: ['It is the tilt.'] },
        ],
      },
      opts,
    ),
    askSocrates(
      {
        proposition: WARM_PROPOSITION,
        speakers: [
          { turn: 1, leanPct: 45, reasoning: 'Not sure.' },
          { turn: 2, leanPct: 95, reasoning: 'Obviously 10 cents.' },
        ],
      },
      opts,
    ),
    gradeSteelman(
      { proposition: WARM_PROPOSITION, side: 'FALSE', text: 'If the ball were 10 cents the total would be 1.20.' },
      opts,
    ),
  ])

  const agents = [
    { name: 'proposer', fallback: proposer.fallback, latencyMs: proposer.latencyMs, model: proposer.model, reason: proposer.reason ?? null },
    { name: 'clusterer', fallback: clusterer.fallback, latencyMs: clusterer.latencyMs, model: clusterer.model, reason: clusterer.reason ?? null },
    { name: 'generator', fallback: generator.fallback, latencyMs: generator.latencyMs, model: generator.model, reason: generator.reason ?? null },
    { name: 'socrates', fallback: socrates.fallback, latencyMs: socrates.latencyMs, model: socrates.model, reason: socrates.reason ?? null },
    { name: 'steelman', fallback: steelman.fallback, latencyMs: steelman.latencyMs, model: steelman.model, reason: steelman.reason ?? null },
  ]

  return NextResponse.json({ ok: true, cache: cacheError ? { error: cacheError } : { ok: true }, agents })
}
