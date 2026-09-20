/**
 * Drive a whole Agora session through the HTTP API with fake students.
 *
 *   npx tsx scripts/simulate.ts [--students 5] [--distribution misconception|split|uncertain]
 *                               [--base http://localhost:3000] [--seed 42]
 *                               [--features considerOpposite,predictClass,...]
 *                               [--cascade] [--elo]
 *
 * Uses lib/api.ts only (no database access), so it exercises exactly what the
 * phones and the dashboard exercise. Prints the blind consensus, the groups,
 * the post-debate consensus, scores, and the belief-map row per question.
 *
 * Plan §17 flows. Each one is inert unless its flag or switch is on, so the
 * default run's API calls, random draws, and output are unchanged:
 *   --features considerOpposite   ~70% of students give a second number (§17.1)
 *   --features predictClass       every submit predicts the class; prints the SP line (§17.2)
 *   --features steelman           ~60% of students write a canned steelman at snapshot (§17.7)
 *   --features socrates           the teacher prepares Socrates after snapshot (§17.4)
 *   --cascade                     Q1 runs twice, the second with the consensus visible (§17.5)
 *   --elo                         students compare argument pairs after resolve (§17.9b; needs argumentElo)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ApiRequestError, createApi } from '../lib/api'
import { mulberry32 } from '../lib/scoring/prng'
import { steelmanSideFor } from '../lib/scoring/steelman'
import {
  FEATURE_KEYS,
  type FeatureKey,
  type FeaturesPatchBody,
  type QuestionInput,
  type SteelmanSide,
  type TeacherView,
} from '../lib/types'

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

/** A bare switch such as `--cascade` (no value). */
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
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

/**
 * Predict the class (plan §17.2): what percent of the class this student
 * expects to say TRUE. In the misconception preset the wrong side expects
 * 75–90% of the class with it and the right side expects to be outvoted by
 * about three to one, which is what makes the right answer surprisingly
 * popular. Drawn as "percent on the wrong side" and mirrored like drawBelief.
 */
function drawPrediction(dist: Distribution, pct: number, correct: boolean, rnd: () => number): number {
  const wrongHigh = !correct
  const onWrongSide = wrongHigh ? pct > 50 : pct < 50
  let wrongSidePct: number
  switch (dist) {
    case 'misconception':
      wrongSidePct = onWrongSide ? 75 + rnd() * 15 : 70 + rnd() * 10
      break
    case 'split':
      wrongSidePct = 45 + rnd() * 10
      break
    case 'uncertain':
      wrongSidePct = 40 + rnd() * 20
      break
  }
  return snap5(wrongHigh ? wrongSidePct : 100 - wrongSidePct)
}

/**
 * Consider the opposite (plan §17.1): the second number, on the other side of
 * 50. The mirror of the first number (100 − pct), nudged 0, 5 or 10 points
 * back toward 50 so the blend is not always exactly 50; never crosses 50.
 */
function drawOpposite(first: number, rnd: () => number): number {
  const mirror = 100 - first
  const nudged = mirror + Math.sign(50 - mirror) * Math.floor(rnd() * 3) * 5
  const opposite = mirror < 50 ? Math.min(50, nudged) : mirror > 50 ? Math.max(50, nudged) : 50
  return snap5(opposite)
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

/**
 * Steelman gate (plan §17.7): one-sentence cases for each side of each demo
 * question, index-aligned with DEMO_QUESTIONS. A student argues the side they
 * lean against, so a student at 80% on the bat and ball writes a FALSE entry.
 */
const STEELMANS: Record<'TRUE' | 'FALSE', string[]>[] = [
  {
    TRUE: [
      'The bat costs a dollar more, and $1.10 minus $1.00 leaves exactly 10 cents for the ball.',
      'The only round split of $1.10 into a whole dollar and some change is $1.00 for the bat and 10 cents for the ball.',
    ],
    FALSE: [
      'If the ball were 10 cents the bat would be $1.10 and the pair would cost $1.20, so the ball must be 5 cents.',
      'Writing b + (b + 1.00) = 1.10 gives 2b = 0.10, so the ball costs 5 cents and the bat $1.05.',
    ],
  },
  {
    TRUE: [
      'Every finite string of nines falls short of 1, so a number written as nines forever never quite arrives.',
      '0.999… names a process that approaches 1, and a process is not the same thing as the value it approaches.',
    ],
    FALSE: [
      'If x = 0.999… then 10x = 9.999…, so 9x = 9 and x = 1: the two are the same number written two ways.',
      'There is no number between 0.999… and 1, and two real numbers with nothing between them are equal.',
    ],
  },
  {
    TRUE: [
      'Gravity pulls harder on a heavier object, so with no air in the way it should pick up speed faster.',
      'Everyday experience shows heavy things landing first, and a vacuum only removes the air, not the weight.',
    ],
    FALSE: [
      'Gravity pulls harder on a heavier object, but the object resists acceleration in exact proportion, so the two cancel.',
      'The hammer and the feather dropped on the Moon landed together, with no air to slow either one.',
    ],
  },
]

const GENERIC_STEELMAN = 'The strongest case for the other side is that the obvious reading of the question is not the only one.'

function cannedSteelman(demoIndex: number, side: SteelmanSide, rnd: () => number): string {
  const entry = STEELMANS[demoIndex]
  if (!entry) return GENERIC_STEELMAN
  const pick: 'TRUE' | 'FALSE' = side === 'EITHER' ? (rnd() < 0.5 ? 'TRUE' : 'FALSE') : side
  const list = entry[pick]
  return list[Math.floor(rnd() * list.length)]
}

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(1))
/** Whole percent, for lines that read like the dashboard's ("67% leaned TRUE"). */
const pct0 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(Math.round(v)))
const answerLabel = (v: boolean | null) => (v === null ? 'none' : v ? 'TRUE' : 'FALSE')

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
  const cascade = flag('cascade')
  const elo = flag('elo')
  if (elo && !features.argumentElo) throw new Error('--elo requires --features argumentElo')

  console.log(
    `Agora simulator → ${base} · ${students} students · ${distribution}${flagNames.length ? ` · flags ${flagNames.join(', ')}` : ''}${cascade ? ' · cascade' : ''}${elo ? ' · elo' : ''}`,
  )

  // Cascade submits are sequential (each reads the live price first), so the
  // blind phase must outlast them or the lazy advance closes it mid-run.
  const blindSeconds = cascade ? Math.min(600, Math.max(20, 3 * students)) : 10
  const questions: QuestionInput[] = cascade
    ? [DEMO_QUESTIONS[0], { ...DEMO_QUESTIONS[0], cascade: true }, DEMO_QUESTIONS[1], DEMO_QUESTIONS[2]]
    : DEMO_QUESTIONS

  const teacher = createApi({ baseUrl: base })
  const created = await teacher.createSession({
    title: `Simulation ${new Date().toISOString().slice(11, 19)}`,
    timers: { blindSeconds, turnSeconds: 5, openSeconds: 10 },
    ...(flagNames.length ? { features } : {}),
  })
  const t = createApi({ baseUrl: base, teacherToken: created.teacherToken })
  console.log(`session ${created.sessionId} · code ${created.code}`)

  const added = await t.addQuestions(created.sessionId, { questions })

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
    const spec = questions[qi]
    const demoIndex = DEMO_QUESTIONS.findIndex((d) => d.proposition === spec.proposition)
    const correct = spec.correctAnswer ?? true
    console.log(`\n== Q${qi + 1}: ${spec.proposition}${spec.cascade ? ' (consensus visible)' : ''}`)

    await t.start(created.sessionId, { questionId: q.id })

    // The number the engine reads per student: the submitted one, or the blend
    // once a second number exists (§17.1).
    const beliefs = new Map<string, number>()
    const seenConsensus: string[] = []
    const secondNumbers: string[] = []
    for (const s of fakes) {
      let pct = drawBelief(distribution, correct, rnd)
      if (spec.cascade) {
        // §17.5: read the live price the phone would show and pull 30% toward it.
        const sv = await s.api.studentView(created.sessionId, s.participantId)
        const visible = sv.pricePct ?? 50
        const own = pct
        pct = snap5(own + 0.3 * (visible - own))
        seenConsensus.push(`${own} (saw ${pct0(visible)}) → ${pct}`)
      }
      const reasoning = rnd() < 0.7 ? REASONS[Math.floor(rnd() * REASONS.length)] : undefined
      const predictedTruePct = features.predictClass ? drawPrediction(distribution, pct, correct, rnd) : undefined
      await s.api.submit(q.id, {
        participantId: s.participantId,
        pct,
        reasoning,
        ...(predictedTruePct === undefined ? {} : { predictedTruePct }),
      })
      beliefs.set(s.participantId, pct)
      if (features.considerOpposite && rnd() < 0.7) {
        const oppositePct = drawOpposite(pct, rnd)
        const res = await s.api.oppose(q.id, { participantId: s.participantId, pct: oppositePct })
        beliefs.set(s.participantId, res.blindPct)
        secondNumbers.push(`(${pct}, ${oppositePct}) → ${res.blindPct}`)
      }
    }
    console.log(`  blind numbers: ${[...beliefs.values()].join(', ')}`)
    if (seenConsensus.length) console.log(`  pulled toward the visible consensus: ${seenConsensus.join(', ')}`)
    if (secondNumbers.length) console.log(`  second numbers (first, opposite) → blend: ${secondNumbers.join(', ')}`)

    await tolerant('blind→snapshot', () => t.advance(q.id, { from: 'blind' }))
    let view: TeacherView = await t.teacherView(created.sessionId)
    console.log(`  blind consensus: ${fmt(view.current?.blindPricePct)}%`)
    for (const g of view.current?.groups ?? []) console.log(`  group ${g.index + 1}: ${g.turnOrder.join(' → ')}`)

    const considered = view.current?.consideredOpposite
    if (features.considerOpposite && considered) {
      console.log(
        `  considered the opposite: ${pct0(considered.pct)}% of submitters · mean shift ${fmt(considered.meanShiftPts)} points`,
      )
    }
    const sp = view.current?.surprisinglyPopular
    if (features.predictClass && sp) {
      console.log(
        `  surprisingly popular: ${answerLabel(sp.answer)} · ${pct0(sp.actualTruePct)}% leaned TRUE vs ${pct0(sp.predictedTruePct)}% expected`,
      )
    }

    if (features.steelman) {
      // §17.7: the gate is open through snapshot and structured; a burst like the proposer's.
      const writers = fakes.filter(() => rnd() < 0.6)
      const results = await Promise.all(
        writers.map((s) => {
          const text = cannedSteelman(demoIndex, steelmanSideFor(beliefs.get(s.participantId)), rnd)
          return s.api.steelman(q.id, { participantId: s.participantId, text })
        }),
      )
      const fallbacks = results.filter((r) => r.fallback).length
      const scores = results.map((r) => (r.score === null ? '—' : String(r.score)))
      view = await t.teacherView(created.sessionId)
      const agg = view.current?.steelman
      const aggLine =
        agg && agg.total > 0 ? ` · ${pct0((100 * agg.count) / agg.total)}% wrote one · mean fidelity ${fmt(agg.meanFidelity)}` : ''
      console.log(`  steelman: ${writers.length} written · fidelity ${scores.join(', ') || '—'} · ${fallbacks} fallbacks${aggLine}`)
    }

    if (features.socrates) {
      // §17.4: one call per group, out of band, before the structured round.
      try {
        const res = await t.socrates(q.id)
        console.log(res.skipped ? '  socrates: skipped' : `  socrates: ready (${res.groups.length} groups, ${res.fallbackCount} fallbacks)`)
      } catch (e) {
        if (!(e instanceof ApiRequestError && e.status === 409)) throw e
        console.log(`  socrates: ${e.code}`)
      }
    }

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
      const extras: string[] = []
      if (features.predictClass && r?.surprisinglyPopular?.insight) extras.push('knew something the crowd did not')
      if (features.steelman && r?.steelman !== null && r?.steelman !== undefined) extras.push(`steelman ${fmt(r.steelman)}`)
      if (features.contrarianCredit && r?.contrarianBonus !== null && r?.contrarianBonus !== undefined) {
        extras.push(`contrarian +${r.contrarianBonus}`)
      }
      console.log(
        `  ${s.name}: final ${sv.my?.pct ?? '—'}% · calibration ${fmt(r?.calibrationFinal)} (before ${fmt(r?.calibrationBlind)}) · persuasion ${fmt(r?.persuasion)}${extras.map((e) => ` · ${e}`).join('')}`,
      )
    }

    if (elo) {
      // §17.9b: every student compares the pairs the server picked for them.
      let cast = 0
      for (const s of fakes) {
        const sv = await s.api.studentView(created.sessionId, s.participantId)
        for (const pair of sv.result?.argumentPairs ?? []) {
          const [winner, loser] = rnd() < 0.6 ? [pair.a, pair.b] : [pair.b, pair.a]
          const res = await s.api.argumentVote(q.id, {
            participantId: s.participantId,
            winnerSubmissionId: winner.id,
            loserSubmissionId: loser.id,
          })
          if (res.counted) cast++
        }
      }
      view = await t.teacherView(created.sessionId)
      const top = view.current?.topArguments[0]
      console.log(
        top
          ? `  top argument (${cast} comparisons cast): "${top.text}" · wins ${pct0(top.winPct)}% of comparisons · argued ${top.side ?? '—'} · ${top.comparisons} comparisons · ${pct0(view.current?.argumentVotersPct)}% of the class compared a pair`
          : `  top argument (${cast} comparisons cast): none`,
      )
    }
  }

  const final = await t.teacherView(created.sessionId)
  if (cascade) {
    const c = final.cascadeComparison
    console.log(
      c
        ? `\ncascade: blind ${fmt(c.blindPricePct)}% · consensus visible ${fmt(c.cascadePricePct)}% · gap ${fmt(c.gapPct)} points · ${c.reading ?? '—'}`
        : '\ncascade: no comparison available',
    )
  }
  console.log('\n== Leaderboard')
  for (const [i, r] of final.leaderboard.entries()) {
    const extra =
      (features.steelman && r.steelman !== undefined ? ` · steelman ${fmt(r.steelman)}` : '') +
      (features.contrarianCredit && r.contrarian !== undefined
        ? ` · contrarian ${r.contrarian === null ? '—' : `+${fmt(r.contrarian)}`}`
        : '')
    console.log(`  ${i + 1}. ${r.name} · calibration ${fmt(r.calibration)} · persuasion ${fmt(r.persuasion)}${extra}`)
  }
  console.log(`\nDashboard: ${base}/t/${created.sessionId} (token ${created.teacherToken})`)
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e)
  process.exit(1)
})
