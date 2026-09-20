/**
 * Drive a whole Agora session through the HTTP API with fake students.
 *
 *   npx tsx scripts/simulate.ts [--students 5] [--distribution misconception|split|uncertain]
 *                               [--base http://localhost:3000] [--seed 42]
 *                               [--features considerOpposite,predictClass,...]
 *
 * Uses lib/api.ts only (no database access), so it exercises exactly what the
 * phones and the dashboard exercise. Prints the blind consensus, the groups,
 * the post-debate consensus, scores, and the belief-map row per question.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ApiRequestError, createApi } from '../lib/api'
import { mulberry32 } from '../lib/scoring/prng'
import { FEATURE_KEYS, type FeatureKey, type FeaturesPatchBody, type QuestionInput, type TeacherView } from '../lib/types'

// --- tiny .env.local loader (no dotenv dependency) ------------------------
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
type Distribution = 'misconception' | 'split' | 'uncertain'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

/** `--features a,b,c` → the flags to switch on at creation (plan §17); unknown names fail fast. */
function parseFeatures(spec: string): FeaturesPatchBody {
  const flags: FeaturesPatchBody = {}
  for (const name of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!(FEATURE_KEYS as readonly string[]).includes(name)) {
      throw new Error(`unknown feature "${name}"; valid: ${FEATURE_KEYS.join(', ')}`)
    }
    flags[name as FeatureKey] = true
  }
  return flags
}

const snap5 = (v: number) => Math.min(100, Math.max(0, Math.round(v / 5) * 5))

/** A blind belief in percent for one student, given the distribution and the correct answer. */
function drawBelief(dist: Distribution, correct: boolean, rnd: () => number): number {
  const wrongHigh = !correct // wrong side is TRUE (high numbers) when the answer is FALSE
  switch (dist) {
    case 'misconception': {
      const onWrongSide = rnd() < 0.8
      const v = onWrongSide ? 70 + rnd() * 20 : 20 + rnd() * 20
      return snap5(wrongHigh ? v : 100 - v)
    }
    case 'split': {
      const high = rnd() < 0.5
      return snap5(high ? 80 + rnd() * 10 : 10 + rnd() * 10)
    }
    case 'uncertain':
      return snap5(40 + rnd() * 20)
  }
}

const DEMO_QUESTIONS: QuestionInput[] = [
  {
    proposition: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. The ball costs 10 cents.',
    mode: 'stem',
    correctAnswer: false,
  },
  { proposition: '0.999… (repeating) is less than 1.', mode: 'stem', correctAnswer: false },
  { proposition: 'Heavier objects fall faster than lighter ones in a vacuum.', mode: 'stem', correctAnswer: false },
]

const REASONS = [
  'It just seems obvious from the numbers.',
  'I remember learning this in school.',
  'Intuition says yes but I am not sure.',
  'The difference has to come from somewhere.',
  'I worked it out roughly in my head.',
  'Everyone says this, so probably.',
]

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(1))

async function tolerant<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 409) {
      console.log(`  (${label}: already advanced)`)
      return null
    }
    throw e
  }
}

async function main(): Promise<void> {
  loadEnvLocal()
  const students = Math.max(1, Number(arg('students', '5')))
  const distribution = arg('distribution', 'misconception') as Distribution
  const base = arg('base', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000')
  const rnd = mulberry32(Number(arg('seed', '42')))
  const features = parseFeatures(arg('features', ''))
  const flagNames = Object.keys(features)

  console.log(
    `Agora simulator → ${base} · ${students} students · ${distribution}${flagNames.length ? ` · flags ${flagNames.join(', ')}` : ''}`,
  )

  const teacher = createApi({ baseUrl: base })
  const created = await teacher.createSession({
    title: `Simulation ${new Date().toISOString().slice(11, 19)}`,
    timers: { blindSeconds: 10, turnSeconds: 5, openSeconds: 10 },
    ...(flagNames.length ? { features } : {}),
  })
  const t = createApi({ baseUrl: base, teacherToken: created.teacherToken })
  console.log(`session ${created.sessionId} · code ${created.code}`)

  const added = await t.addQuestions(created.sessionId, { questions: DEMO_QUESTIONS })

  const fakes: { name: string; participantId: string; api: ReturnType<typeof createApi> }[] = []
  for (let i = 0; i < students; i++) {
    const api = createApi({ baseUrl: base })
    const name = `Sim ${i + 1}`
    const joined = await api.join({ code: created.code, displayName: name })
    fakes.push({ name, participantId: joined.participantId, api })
  }
  console.log(`${fakes.length} students joined`)

  for (let qi = 0; qi < added.questions.length; qi++) {
    const q = added.questions[qi]
    const spec = DEMO_QUESTIONS[qi]
    const correct = spec.correctAnswer ?? true
    console.log(`\n== Q${qi + 1}: ${spec.proposition}`)

    await t.start(created.sessionId, { questionId: q.id })

    const beliefs = new Map<string, number>()
    for (const s of fakes) {
      const pct = drawBelief(distribution, correct, rnd)
      beliefs.set(s.participantId, pct)
      const reasoning = rnd() < 0.7 ? REASONS[Math.floor(rnd() * REASONS.length)] : undefined
      await s.api.submit(q.id, { participantId: s.participantId, pct, reasoning })
    }
    console.log(`  blind numbers: ${[...beliefs.values()].join(', ')}`)

    await tolerant('blind→snapshot', () => t.advance(q.id, { from: 'blind' }))
    let view: TeacherView = await t.teacherView(created.sessionId)
    console.log(`  blind consensus: ${fmt(view.current?.blindPricePct)}%`)
    for (const g of view.current?.groups ?? []) console.log(`  group ${g.index + 1}: ${g.turnOrder.join(' → ')}`)

    await tolerant('snapshot→structured', () => t.advance(q.id, { from: 'snapshot' }))
    await tolerant('structured→open', () => t.advance(q.id, { from: 'structured' }))

    // A few students move toward the truth during the open phase.
    const movers = fakes.filter(() => rnd() < 0.5)
    for (const s of movers) {
      const before = beliefs.get(s.participantId) ?? 50
      const target = correct ? Math.min(100, before + 20) : Math.max(0, before - 20)
      await s.api.revise(q.id, { participantId: s.participantId, pct: snap5(target) })
    }
    view = await t.teacherView(created.sessionId)
    console.log(`  after ${movers.length} revisions, live consensus: ${fmt(view.current?.pricePct)}%`)

    await tolerant('open→resolved', () => t.advance(q.id, { from: 'open', correctAnswer: correct }))
    view = await t.teacherView(created.sessionId)
    const row = view.questions.find((r) => r.id === q.id)
    console.log(`  post-debate consensus: ${fmt(row?.postPricePct)}%`)
    console.log(`  belief map: blind ${fmt(row?.blindPricePct)} → after ${fmt(row?.postPricePct)} · ${row?.reading ?? '—'}`)

    const sample = fakes.slice(0, Math.min(3, fakes.length))
    for (const s of sample) {
      const sv = await s.api.studentView(created.sessionId, s.participantId)
      const r = sv.result
      console.log(
        `  ${s.name}: final ${sv.my?.pct ?? '—'}% · calibration ${fmt(r?.calibrationFinal)} (before ${fmt(r?.calibrationBlind)}) · persuasion ${fmt(r?.persuasion)}`,
      )
    }
  }

  const final = await t.teacherView(created.sessionId)
  console.log('\n== Leaderboard')
  for (const [i, r] of final.leaderboard.entries()) {
    console.log(`  ${i + 1}. ${r.name} · calibration ${fmt(r.calibration)} · persuasion ${fmt(r.persuasion)}`)
  }
  console.log(`\nDashboard: ${base}/t/${created.sessionId} (token ${created.teacherToken})`)
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e)
  process.exit(1)
})
