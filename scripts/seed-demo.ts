/**
 * Demo seeding: one command that leaves a session ready for the §12 script.
 *
 *   npx tsx scripts/seed-demo.ts [--base http://localhost:3000] [--cascade] [--no-warm]
 *
 *   1. creates the demo session with the fast timer preset and DEMO_FEATURES,
 *   2. adds the three demo questions (with --cascade, Q1 twice: the second run
 *      shows the live consensus during blind for the herding beat, plan §17.5),
 *   3. pre-warms every agent through GET /api/health/agents,
 *   4. prints the join code, dashboard URL, projector URL, and teacher token.
 *
 * Uses lib/api.ts only (no database access), so it works against any deployed
 * URL. Exits 1 with a clear message when the server cannot be reached. Must
 * not import lib/db/server or lib/agents/cache (server-only).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { ApiRequestError, createApi } from '../lib/api'
import type { FeaturesPatchBody, QuestionInput, Timers } from '../lib/types'

/**
 * The flags the demo runs with. Edit here; the dashboard's settings card can
 * also toggle them between questions, since views read them live. Pitch line
 * for this preset: "Two questions from MIT research, one from Socrates."
 */
export const DEMO_FEATURES: FeaturesPatchBody = {
  considerOpposite: true,
  predictClass: true,
  socrates: true,
  steelman: false,
  contrarianCredit: false,
  argumentElo: false,
}

/** Fast preset: three questions in under ten minutes (§17.1 adds ~30 s per blind phase). */
export const DEMO_TIMERS: Timers = { blindSeconds: 45, turnSeconds: 20, openSeconds: 45 }

/**
 * Duplicated from scripts/simulate.ts, which runs main() at import and so
 * cannot be imported here. Keep the two lists in sync.
 */
const DEMO_QUESTIONS: QuestionInput[] = [
  {
    proposition: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. The ball costs 10 cents.',
    mode: 'stem',
    correctAnswer: false,
  },
  { proposition: '0.999… (repeating) is less than 1.', mode: 'stem', correctAnswer: false },
  { proposition: 'Heavier objects fall faster than lighter ones in a vacuum.', mode: 'stem', correctAnswer: false },
]

// --- tiny .env.local loader (same as scripts/simulate.ts) -----------------
function loadEnvLocal(): void {
  try {
    const text = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = value
    }
  } catch {
    // no .env.local; fine
  }
}

// --- args ----------------------------------------------------------------
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

// --- pre-warm ------------------------------------------------------------
/** Lenient shape of GET /api/health/agents: only the name and fallback matter here. */
const HealthResult = z.object({
  cache: z.union([z.object({ ok: z.literal(true) }), z.object({ error: z.string() })]).optional(),
  agents: z.array(
    z.object({
      name: z.string(),
      fallback: z.boolean(),
      latencyMs: z.number().nullable().optional(),
      model: z.string().nullable().optional(),
      reason: z.string().nullable().optional(),
    }),
  ),
})

async function warmAgents(base: string): Promise<void> {
  const url = `${base}/api/health/agents`
  let res: Response
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(60_000) })
  } catch (e) {
    console.log(`  warm-up failed: ${e instanceof Error ? e.message : String(e)} (the session is still usable)`)
    return
  }
  if (!res.ok) {
    console.log(`  warm-up failed: HTTP ${res.status} from ${url} (the session is still usable)`)
    return
  }
  const parsed = HealthResult.safeParse(await res.json().catch(() => null))
  if (!parsed.success) {
    console.log(`  warm-up returned an unexpected shape from ${url} (the session is still usable)`)
    return
  }
  if (parsed.data.cache && 'error' in parsed.data.cache) console.log(`  cache: ${parsed.data.cache.error}`)
  for (const a of parsed.data.agents) {
    const latency = a.latencyMs === null || a.latencyMs === undefined ? '—' : `${Math.round(a.latencyMs)} ms`
    const status = a.fallback ? `FALLBACK${a.reason ? ` (${a.reason})` : ''}` : 'ok'
    console.log(`  ${a.name.padEnd(10)} ${status} · ${latency}${a.model ? ` · ${a.model}` : ''}`)
  }
}

// --- main ----------------------------------------------------------------
async function main(): Promise<void> {
  loadEnvLocal()
  const base = arg('base', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  const cascade = flag('cascade')
  const warm = !flag('no-warm')

  const questions: QuestionInput[] = cascade
    ? [DEMO_QUESTIONS[0], { ...DEMO_QUESTIONS[0], cascade: true }, DEMO_QUESTIONS[1], DEMO_QUESTIONS[2]]
    : DEMO_QUESTIONS
  const flagsOn = (Object.keys(DEMO_FEATURES) as (keyof FeaturesPatchBody)[]).filter((k) => DEMO_FEATURES[k])

  console.log(`Agora demo seed → ${base}${cascade ? ' · cascade' : ''}`)

  const teacher = createApi({ baseUrl: base })
  let created
  try {
    created = await teacher.createSession({ title: 'Agora demo', timers: DEMO_TIMERS, features: DEMO_FEATURES })
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 0) {
      console.error(`seed-demo: cannot reach ${base} (${e.message}). Start the server with \`npm run dev\` or pass --base <url>.`)
      process.exit(1)
    }
    throw e
  }
  const t = createApi({ baseUrl: base, teacherToken: created.teacherToken })
  const added = await t.addQuestions(created.sessionId, { questions })
  console.log(`session ${created.sessionId} · ${added.questions.length} questions added`)

  if (warm) {
    console.log('\nPre-warming agents (GET /api/health/agents)…')
    await warmAgents(base)
  }

  console.log('\nAgora demo session ready')
  console.log(`  join code      ${created.code}`)
  console.log(`  join URL       ${base}/join?code=${encodeURIComponent(created.code)}`)
  console.log(`  dashboard      ${base}/t/${created.sessionId}`)
  console.log(`  projector      ${base}/t/${created.sessionId}/present`)
  console.log(`  teacher token  ${created.teacherToken}`)
  console.log('                 (paste it into the dashboard token prompt; the projector reads it from that browser)')
  console.log(`  timers         blind ${DEMO_TIMERS.blindSeconds} s · turn ${DEMO_TIMERS.turnSeconds} s · open ${DEMO_TIMERS.openSeconds} s`)
  console.log(`  features on    ${flagsOn.length ? flagsOn.join(', ') : 'none'}`)
  for (const [i, q] of questions.entries()) {
    console.log(`  Q${i + 1}${q.cascade ? ' (consensus visible)' : ''}  ${q.proposition}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e)
  process.exit(1)
})
