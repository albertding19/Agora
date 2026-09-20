/**
 * Agent test-set runner.
 *
 *   npx tsx scripts/agent-eval.ts proposer [--concurrency 10]
 *   npx tsx scripts/agent-eval.ts clusterer
 *   npx tsx scripts/agent-eval.ts generator
 *   npx tsx scripts/agent-eval.ts socrates
 *   npx tsx scripts/agent-eval.ts steelman
 *
 * Runs every case in lib/agents/__tests__/<agent>.cases.json against the live
 * API with the cache bypassed and N calls in flight (default 10) so the p95
 * reflects a burst of students tapping at once. Bar: 8/10. Decide the
 * proposer's model on the p95, not the p50.
 *
 * Run from the repo root. Reads .env.local if present. Skips (exit 0) when
 * ANTHROPIC_API_KEY is unset. Must not import lib/db/server or lib/agents/cache
 * (they are server-only).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { clustererSpec, type ClustererInput, type ClustererOutput } from '../lib/agents/clusterer'
import {
  generatorSpec,
  isInterrogative,
  PROPOSITION_MAX_CHARS,
  type GeneratorInput,
  type GeneratorOutput,
} from '../lib/agents/generator'
import { proposerSpec, type ProposerInput } from '../lib/agents/proposer'
import { runAgent, type AgentResult, type AgentSpec } from '../lib/agents/run'
import {
  LEAN_LABEL_RE,
  MAX_SENTENCES_PER_TURN,
  slotFallback,
  socratesSpec,
  splitSentences,
  type SocratesInput,
  type SocratesOutput,
} from '../lib/agents/socrates'
import { NOTE_MAX_CHARS, steelmanSpec, type SteelmanInput, type SteelmanOutput } from '../lib/agents/steelman'
import { findBannedWord } from '../lib/language'
import type { Band } from '../lib/types'

const AGENTS = ['proposer', 'clusterer', 'generator', 'socrates', 'steelman'] as const
type AgentName = (typeof AGENTS)[number]

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

function loadEnvLocal() {
  const file = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

// ---------------------------------------------------------------------------
// cases
// ---------------------------------------------------------------------------

interface ProposerCase {
  name: string
  input: ProposerInput
  expect: { stance: string | string[]; bandContains?: number; minLo?: number; maxHi?: number }
}

interface ClustererCase {
  name: string
  input: ClustererInput
  expect: { minClusters: number; maxClusters: number; mustGroupTogether?: number[][] }
}

interface GeneratorCase {
  name: string
  input: GeneratorInput
  expect: {
    minCandidates: number
    maxCandidates: number
    /** Regex source; at least one candidate text must match. */
    anyTextMatches?: string
    /** Both TRUE and FALSE must appear among the candidates. */
    mixedAnswers?: boolean
    /** Checked against candidates[0]. */
    first?: { sourceClusterIndex?: number | null; correctAnswer?: boolean; textMatches?: string }
  }
}

interface SocratesCase {
  name: string
  input: SocratesInput
  expect: {
    /** questions[index] must match the regex source. */
    targets?: { index: number; regex: string }[]
    /** Regex source that no question may match (the answer must not leak). */
    noAnswerLeak?: string
  }
}

interface SteelmanCase {
  name: string
  input: SteelmanInput
  expect: { min: number; max: number }
}

function loadCases<T>(agent: string): T[] {
  const file = path.resolve(process.cwd(), 'lib/agents/__tests__', `${agent}.cases.json`)
  return JSON.parse(readFileSync(file, 'utf8')) as T[]
}

function checkProposer(c: ProposerCase, r: AgentResult<Band>): string[] {
  const problems: string[] = []
  if (r.fallback) problems.push(`fallback (${r.reason ?? 'unknown'})`)
  const want = Array.isArray(c.expect.stance) ? c.expect.stance : [c.expect.stance]
  const b = r.output
  if (!want.includes(b.stance)) problems.push(`stance ${b.stance}, wanted ${want.join('|')}`)
  if (c.expect.bandContains !== undefined && (b.lo > c.expect.bandContains || b.hi < c.expect.bandContains)) {
    problems.push(`band ${b.lo}-${b.hi} does not contain ${c.expect.bandContains}`)
  }
  if (c.expect.minLo !== undefined && b.lo < c.expect.minLo) problems.push(`lo ${b.lo} < ${c.expect.minLo}`)
  if (c.expect.maxHi !== undefined && b.hi > c.expect.maxHi) problems.push(`hi ${b.hi} > ${c.expect.maxHi}`)
  if (b.hi - b.lo < 15) problems.push(`band width ${b.hi - b.lo} < 15`)
  return problems
}

function checkClusterer(c: ClustererCase, r: AgentResult<ClustererOutput>): string[] {
  const problems: string[] = []
  if (r.fallback) problems.push(`fallback (${r.reason ?? 'unknown'})`)
  const clusters = r.output.clusters
  if (clusters.length < c.expect.minClusters || clusters.length > c.expect.maxClusters) {
    problems.push(`${clusters.length} clusters, wanted ${c.expect.minClusters}-${c.expect.maxClusters}`)
  }
  const where = new Map<number, number>()
  clusters.forEach((cl, idx) => cl.members.forEach((m) => where.set(m, idx)))
  const missing = c.input.reasons.map((x) => x.i).filter((i) => !where.has(i))
  if (missing.length) problems.push(`unassigned indices ${missing.join(',')}`)
  for (const group of c.expect.mustGroupTogether ?? []) {
    const homes = new Set(group.map((i) => where.get(i)))
    if (homes.size !== 1) problems.push(`expected ${group.join(',')} together`)
  }
  return problems
}

function checkGenerator(c: GeneratorCase, r: AgentResult<GeneratorOutput>): string[] {
  const problems: string[] = []
  if (r.fallback) problems.push(`fallback (${r.reason ?? 'unknown'})`)
  const candidates = r.output.candidates
  const { minCandidates, maxCandidates, anyTextMatches, mixedAnswers, first } = c.expect
  if (candidates.length < minCandidates || candidates.length > maxCandidates) {
    problems.push(`${candidates.length} candidates, wanted ${minCandidates}-${maxCandidates}`)
  }
  candidates.forEach((cand, i) => {
    const text = cand.text
    if (!text.endsWith('.')) problems.push(`candidate ${i} does not end with "."`)
    if (text.length > PROPOSITION_MAX_CHARS) problems.push(`candidate ${i} is ${text.length} chars > ${PROPOSITION_MAX_CHARS}`)
    if (isInterrogative(text)) problems.push(`candidate ${i} is a question, not a claim`)
    const banned = findBannedWord(text) ?? findBannedWord(cand.misconception)
    if (banned) problems.push(`candidate ${i} contains banned word "${banned}"`)
  })
  if (anyTextMatches !== undefined) {
    const re = new RegExp(anyTextMatches, 'i')
    if (!candidates.some((cand) => re.test(cand.text))) problems.push(`no candidate text matches /${anyTextMatches}/`)
  }
  if (mixedAnswers) {
    const hasTrue = candidates.some((cand) => cand.correctAnswer === true)
    const hasFalse = candidates.some((cand) => cand.correctAnswer === false)
    if (!hasTrue || !hasFalse) problems.push('expected both TRUE and FALSE candidates')
  }
  if (first) {
    const head = candidates[0]
    if (!head) {
      problems.push('no first candidate to check')
    } else {
      if (first.sourceClusterIndex !== undefined && head.sourceClusterIndex !== first.sourceClusterIndex) {
        problems.push(`first sourceClusterIndex ${head.sourceClusterIndex}, wanted ${first.sourceClusterIndex}`)
      }
      if (first.correctAnswer !== undefined && head.correctAnswer !== first.correctAnswer) {
        problems.push(`first correctAnswer ${head.correctAnswer}, wanted ${first.correctAnswer}`)
      }
      if (first.textMatches !== undefined && !new RegExp(first.textMatches, 'i').test(head.text)) {
        problems.push(`first text does not match /${first.textMatches}/`)
      }
    }
  }
  return problems
}

const PERCENT_RE = /\d+\s*%|\bpercent\b/i
const SPEAKER_PREFIX_RE = /^speaker\s*\d/i

function checkSocrates(c: SocratesCase, r: AgentResult<SocratesOutput>): string[] {
  const problems: string[] = []
  if (r.fallback) problems.push(`fallback (${r.reason ?? 'unknown'})`)
  const questions = r.output.questions
  const n = c.input.speakers.length
  if (questions.length !== n) problems.push(`${questions.length} questions, wanted ${n}`)
  questions.forEach((q, i) => {
    const sentences = splitSentences(q)
    if (sentences.length === 0) problems.push(`question ${i} is empty`)
    if (sentences.length > MAX_SENTENCES_PER_TURN) problems.push(`question ${i} has ${sentences.length} sentences`)
    if (sentences.some((s) => !s.trim().endsWith('?'))) problems.push(`question ${i} has a sentence that is not a question`)
    if (PERCENT_RE.test(q)) problems.push(`question ${i} quotes a percentage`)
    if (LEAN_LABEL_RE.test(q)) problems.push(`question ${i} echoes a lean label`)
    if (SPEAKER_PREFIX_RE.test(q)) problems.push(`question ${i} starts with a "Speaker N" prefix`)
    const banned = findBannedWord(q)
    if (banned) problems.push(`question ${i} contains banned word "${banned}"`)
  })
  if (questions.length > 0 && questions.every((q, i) => q === slotFallback(i, questions.length))) {
    problems.push('every question is the slot fallback')
  }
  for (const t of c.expect.targets ?? []) {
    const q = questions[t.index]
    if (q === undefined || !new RegExp(t.regex, 'i').test(q)) problems.push(`question ${t.index} does not match /${t.regex}/`)
  }
  if (c.expect.noAnswerLeak !== undefined) {
    const re = new RegExp(c.expect.noAnswerLeak, 'i')
    questions.forEach((q, i) => {
      if (re.test(q)) problems.push(`question ${i} leaks the answer (/${c.expect.noAnswerLeak}/)`)
    })
  }
  return problems
}

function checkSteelman(c: SteelmanCase, r: AgentResult<SteelmanOutput>): string[] {
  const problems: string[] = []
  if (r.fallback) problems.push(`fallback (${r.reason ?? 'unknown'})`)
  const { fidelity, note } = r.output
  if (fidelity === null) {
    problems.push('fidelity is null')
  } else {
    if (fidelity % 5 !== 0) problems.push(`fidelity ${fidelity} is not a multiple of 5`)
    if (fidelity < c.expect.min || fidelity > c.expect.max) {
      problems.push(`fidelity ${fidelity} outside ${c.expect.min}-${c.expect.max}`)
    }
  }
  if (note.trim().length === 0) problems.push('note is empty')
  if (note.length > NOTE_MAX_CHARS) problems.push(`note is ${note.length} chars > ${NOTE_MAX_CHARS}`)
  const banned = findBannedWord(note)
  if (banned) problems.push(`note contains banned word "${banned}"`)
  return problems
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

async function pool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

async function evaluate<I, O, C extends { name: string; input: I }>(
  spec: AgentSpec<I, O>,
  cases: C[],
  check: (c: C, r: AgentResult<O>) => string[],
  concurrency: number,
) {
  console.log(`agent ${spec.name} v${spec.version} model ${spec.model} effort ${spec.effort} deadline ${spec.deadlineMs}ms`)
  console.log(`${cases.length} cases, ${concurrency} in flight\n`)
  const results = await pool(cases, concurrency, (c) => runAgent(spec, c.input, { bypassCache: true }))
  let passed = 0
  let fallbacks = 0
  results.forEach((r, i) => {
    const problems = check(cases[i], r)
    if (r.fallback) fallbacks++
    const ok = problems.length === 0
    if (ok) passed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${cases[i].name}  (${r.latencyMs} ms)`)
    console.log(`      ${JSON.stringify(r.output)}`)
    if (!ok) console.log(`      ${problems.join('; ')}`)
  })
  const latencies = results.map((r) => r.latencyMs)
  console.log(`\npassed ${passed}/${cases.length}`)
  console.log(`fallbacks ${fallbacks}`)
  console.log(`latency p50 ${percentile(latencies, 50)} ms, p95 ${percentile(latencies, 95)} ms, max ${Math.max(...latencies)} ms`)
  return passed
}

async function main() {
  loadEnvLocal()
  const args = process.argv.slice(2)
  const agent = args.find((a) => !a.startsWith('--'))
  const cIdx = args.indexOf('--concurrency')
  const concurrency = cIdx >= 0 ? Number(args[cIdx + 1]) || 10 : 10

  if (!agent || !(AGENTS as readonly string[]).includes(agent)) {
    console.error(`usage: npx tsx scripts/agent-eval.ts <${AGENTS.join('|')}> [--concurrency N]`)
    process.exit(2)
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('skipped: ANTHROPIC_API_KEY not set')
    process.exit(0)
  }

  switch (agent as AgentName) {
    case 'proposer':
      await evaluate(proposerSpec, loadCases<ProposerCase>('proposer'), checkProposer, concurrency)
      break
    case 'clusterer':
      await evaluate(clustererSpec, loadCases<ClustererCase>('clusterer'), checkClusterer, concurrency)
      break
    case 'generator':
      await evaluate(generatorSpec, loadCases<GeneratorCase>('generator'), checkGenerator, concurrency)
      break
    case 'socrates':
      await evaluate(socratesSpec, loadCases<SocratesCase>('socrates'), checkSocrates, concurrency)
      break
    case 'steelman':
      await evaluate(steelmanSpec, loadCases<SteelmanCase>('steelman'), checkSteelman, concurrency)
      break
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
