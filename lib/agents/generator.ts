/**
 * Question generator (P1 / plan §17.3). Turns either a teacher's topic or the
 * answer clusters of an open question into contestable propositions that can
 * become the next STEM question.
 *
 * Two kinds of request:
 *   - topic:   5 propositions, each built on a documented misconception,
 *              at least two TRUE and two FALSE.
 *   - cluster: 1-3 propositions, each stating as a confident claim what one
 *              answer cluster believes, largest conflicting cluster first.
 *
 * Output is aggregate only: the agent sees labels, counts and sample texts,
 * never names. A fallback never inserts anything; the teacher edits and
 * confirms every candidate before it becomes a question.
 */
import { z } from 'zod'
import { LANGUAGE_RULE, findBannedWord } from '@/lib/language'
import type { Candidate } from '@/lib/types'
import { OTHER_LABEL } from './clusterer'
import {
  DEFAULT_DEADLINE_MS,
  DEFAULT_MODEL,
  PROMPT_TAIL,
  runAgent,
  type AgentResult,
  type AgentSpec,
  type RunOptions,
} from './run'

export interface GeneratorCluster {
  label: string
  count: number
  samples: string[]
}

export type GeneratorInput =
  | { kind: 'topic'; topic: string }
  | {
      kind: 'cluster'
      question: string
      referenceAnswer: string | null
      clusters: GeneratorCluster[]
    }

export interface GeneratorOutput {
  candidates: Candidate[]
}

export const GENERATOR_VERSION = 1
export const MAX_TOPIC_CANDIDATES = 5
export const MAX_CLUSTER_CANDIDATES = 3
export const PROPOSITION_MIN_CHARS = 10
export const PROPOSITION_MAX_CHARS = 300
export const MISCONCEPTION_MAX_CHARS = 200
export const SAMPLES_PER_CLUSTER = 3

/** Used when the model leaves the misconception blank. */
export const DEFAULT_MISCONCEPTION = 'A common misconception.'
/** Misconception on every cluster-kind fallback candidate. */
export const FALLBACK_MISCONCEPTION = 'Could not be read. Set the answer yourself before adding.'

/** Canned list used when topic generation falls back. Not topic-specific. */
export const CANNED_TOPIC_LIST: readonly Candidate[] = [
  {
    text: 'A bat and a ball cost $1.10 in total and the bat costs $1.00 more than the ball, so the ball costs 10 cents.',
    correctAnswer: false,
    misconception:
      'Subtracting $1.00 from $1.10 gives 10 cents, but then the bat would cost only 90 cents more than the ball.',
    sourceClusterIndex: null,
  },
  {
    text: '0.999… (repeating forever) is equal to 1.',
    correctAnswer: true,
    misconception: 'A number that keeps getting closer to 1 must stay a tiny bit short of it.',
    sourceClusterIndex: null,
  },
  {
    text: 'In a vacuum, a heavier object falls faster than a lighter one.',
    correctAnswer: false,
    misconception: 'Weight feels like it should add speed, because in everyday air heavy things often land first.',
    sourceClusterIndex: null,
  },
  {
    text: 'The seasons happen because the Earth is closer to the Sun in summer and farther away in winter.',
    correctAnswer: false,
    misconception: 'Closer to a heat source means warmer, so summer must be when the Earth is nearest the Sun.',
    sourceClusterIndex: null,
  },
  {
    text: 'The Great Wall of China is visible to the naked eye from low Earth orbit.',
    correctAnswer: false,
    misconception: 'Something very long must also be easy to see from far away, but the wall is only a few metres wide.',
    sourceClusterIndex: null,
  },
]

/** Raw model output. Plain types only; everything else is enforced in normalize. */
const RawCandidates = z.object({
  candidates: z.array(
    z.object({
      text: z.string(),
      correctAnswer: z.enum(['TRUE', 'FALSE']),
      misconception: z.string(),
      sourceClusterIndex: z.number(),
    }),
  ),
})

// ---------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------

const INTERROGATIVE_OPENER =
  /^(?:to what extent|why|how|what|which|who|whom|whose|is|are|am|was|were|do|does|did|can|could|should|would|will|shall)\b/i

/** Closing quotes and brackets (straight and curly) that may trail a sentence's final punctuation. */
const CLOSERS = `["'’”»)\\]]`
/** Opening quotes and brackets that may precede the first word. */
const OPENERS = /^["'‘“«(\[]+/
/** Ends with "?" (a trailing "!" or closer after it does not hide it). */
const ENDS_WITH_QUESTION = new RegExp(`\\?[?!]*${CLOSERS}*$`)
/** Trailing exclamation marks, possibly inside closing quotes. Mid-text "!" (5!) is left alone. */
const TRAILING_BANGS = new RegExp(`!+(${CLOSERS}*)$`)
/** A dangling comma, semicolon or colon before the end (or before a final period). */
const DANGLING_SEPARATOR = new RegExp(`[,;:]+(${CLOSERS}*\\.?)$`)
/** A period sitting inside a closing quote or bracket. */
const PERIOD_INSIDE_CLOSER = new RegExp(`\\.(${CLOSERS}+)$`)
/** Whitespace before the final period (and any closers in front of it). */
const SPACE_BEFORE_FINAL_PERIOD = new RegExp(`\\s+(${CLOSERS}*\\.)$`)

/**
 * True when a text reads as a question: it ends with "?" (closing quotes or
 * brackets allowed after it) or begins with an interrogative word, after any
 * opening quote or bracket. Pure; the eval checker reuses it.
 */
export function isInterrogative(text: string): boolean {
  const t = text.trim()
  if (ENDS_WITH_QUESTION.test(t)) return true
  return INTERROGATIVE_OPENER.test(t.replace(OPENERS, ''))
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Clean one proposition text, or return null when it must be dropped:
 *  - whitespace trimmed and collapsed
 *  - a trailing "!" reads as a period (a mid-text "!" such as "5!" is kept)
 *  - question-form texts dropped, including "…?!" and quoted questions
 *  - a dangling comma/semicolon/colon is removed; a period inside a closing
 *    quote or bracket moves outside it; a period is appended when missing
 *  - shorter than 10 or longer than 300 characters dropped (never cut mid-sentence)
 *  - any banned word drops it
 */
function cleanText(raw: string): string | null {
  let text = raw.trim().replace(/\s+/g, ' ')
  if (!text) return null
  text = text.replace(TRAILING_BANGS, '$1')
  if (isInterrogative(text)) return null
  text = text
    .replace(DANGLING_SEPARATOR, '$1')
    .replace(PERIOD_INSIDE_CLOSER, '$1.')
    .replace(SPACE_BEFORE_FINAL_PERIOD, '$1')
    .trim()
  if (!text.endsWith('.')) text += '.'
  if (text.length < PROPOSITION_MIN_CHARS || text.length > PROPOSITION_MAX_CHARS) return null
  if (findBannedWord(text)) return null
  return text
}

/** Clean a misconception; null means the candidate must be dropped. */
function cleanMisconception(raw: string): string | null {
  const m = raw.trim().replace(/\s+/g, ' ').slice(0, MISCONCEPTION_MAX_CHARS).trim()
  if (findBannedWord(m)) return null
  return m || DEFAULT_MISCONCEPTION
}

function clusterCount(input: GeneratorInput, c: Candidate): number | null {
  if (input.kind !== 'cluster' || c.sourceClusterIndex === null) return null
  return input.clusters[c.sourceClusterIndex]?.count ?? null
}

/** Stable order: larger source cluster first, unknown source last. */
function byClusterCount(input: GeneratorInput) {
  return (a: Candidate, b: Candidate): number => {
    const ra = clusterCount(input, a)
    const rb = clusterCount(input, b)
    if (ra === rb) return 0
    if (ra === null) return 1
    if (rb === null) return -1
    return rb - ra
  }
}

// ---------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------

/**
 * Normalize raw candidates:
 *  - text cleaned per cleanText; unusable texts dropped
 *  - duplicates (case-insensitive text) dropped, first wins
 *  - misconception trimmed to 200 chars, defaulted when empty, candidate
 *    dropped on a banned word
 *  - correctAnswer TRUE/FALSE → boolean
 *  - sourceClusterIndex: null for topic; a valid cluster index or null for cluster
 *  - cluster kind stable-sorted by source cluster count, largest first
 *  - capped at 5 (topic) or 3 (cluster)
 * Returns null when the shape is unusable or nothing survives.
 */
export function normalizeGenerator(raw: unknown, input: GeneratorInput): GeneratorOutput | null {
  const parsed = RawCandidates.safeParse(raw)
  if (!parsed.success) return null

  const seen = new Set<string>()
  const kept: Candidate[] = []
  for (const c of parsed.data.candidates) {
    const text = cleanText(c.text)
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    const misconception = cleanMisconception(c.misconception)
    if (misconception === null) continue
    seen.add(key)

    let sourceClusterIndex: number | null = null
    if (input.kind === 'cluster') {
      const idx = c.sourceClusterIndex
      if (Number.isInteger(idx) && idx >= 0 && idx < input.clusters.length) sourceClusterIndex = idx
    }

    kept.push({ text, correctAnswer: c.correctAnswer === 'TRUE', misconception, sourceClusterIndex })
  }

  if (kept.length === 0) return null
  if (input.kind === 'cluster') kept.sort(byClusterCount(input))
  const cap = input.kind === 'topic' ? MAX_TOPIC_CANDIDATES : MAX_CLUSTER_CANDIDATES
  return { candidates: kept.slice(0, cap) }
}

// ---------------------------------------------------------------------------
// fallback
// ---------------------------------------------------------------------------

/**
 * Canned output. Topic → the fixed list. Cluster → one candidate per
 * non-"Other" cluster in count order (at most 3), the label capitalised with
 * a trailing period, correctAnswer false, and a misconception telling the
 * teacher to set the answer. Every candidate passes the normalizer's rules.
 */
export function generatorFallback(input: GeneratorInput): GeneratorOutput {
  if (input.kind === 'topic') return { candidates: CANNED_TOPIC_LIST.map((c) => ({ ...c })) }

  const ranked = input.clusters
    .map((c, index) => ({ label: c.label.trim(), count: c.count, index }))
    .filter((c) => c.label && c.label.toLowerCase() !== OTHER_LABEL.toLowerCase())
    .sort((a, b) => b.count - a.count)

  const seen = new Set<string>()
  const candidates: Candidate[] = []
  for (const c of ranked) {
    if (candidates.length >= MAX_CLUSTER_CANDIDATES) break
    const text = cleanText(capitalise(c.label.replace(/[.!\s]+$/, '')))
    if (!text || seen.has(text.toLowerCase())) continue
    seen.add(text.toLowerCase())
    candidates.push({
      text,
      correctAnswer: false,
      misconception: FALLBACK_MISCONCEPTION,
      sourceClusterIndex: c.index,
    })
  }
  return { candidates }
}

// ---------------------------------------------------------------------------
// prompt
// ---------------------------------------------------------------------------

const SYSTEM = [
  'You are the question generator inside Agora, a classroom tool that measures what a class believes, how confidently, and how those beliefs move under structured debate.',
  'You write propositions: single declarative claims that a class rates its confidence in, from 0% to 100% TRUE, and that a debate can settle.',
  'You receive one of two kinds of request.',
  '1. TOPIC. A teacher names a topic. Write 5 propositions, each built on a documented misconception that students commonly hold about that topic. At least two must be TRUE and at least two FALSE, so the class cannot guess a pattern. Set sourceClusterIndex to -1 for every one.',
  '2. CLUSTER. A teacher asked the class an open question, students answered in free text, and the answers were grouped into clusters, each with a label, a count, and a few sample answers. A reference answer describing what a right answer says may be given. Write 1 to 3 propositions. Each states, as a confident declarative claim, what one cluster believes. Start with the largest cluster whose belief conflicts with the reference answer (or with established knowledge when no reference is given), then the next largest conflicting cluster. Skip clusters that agree with the reference answer and skip the cluster labelled "Other". Set sourceClusterIndex to the index of the cluster the proposition came from.',
  'Rules for every proposition:',
  '- text: one sentence, at most 300 characters, ending with a period.',
  '- A claim, never a question. Never begin with "To what extent", "Why", "How", "What", "Is", "Are", "Do" or "Does".',
  '- Contestable and specific: a reasonable student could sit on either side, and the debate has something concrete to settle.',
  '- Self-contained: include every number, name, and condition needed to judge it, so it reads on its own with no other context.',
  '- correctAnswer: the actual truth of the claim as written. A proposition that states a misconception is FALSE.',
  '- misconception: one sentence, at most 200 characters, naming the common belief or reasoning slip the proposition tests. Describe the idea, never any individual.',
  '- Never put judgement words in the proposition text ("wrong", "obviously", "mistaken", "naive", "confused").',
  '- Never name or describe a student. You only see labels, counts and sample texts.',
  `- ${LANGUAGE_RULE}`,
  PROMPT_TAIL,
].join('\n')

function collapse(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

function userMessage(input: GeneratorInput): string {
  if (input.kind === 'topic') {
    return [`Request: TOPIC`, `Topic: "${collapse(input.topic)}"`, 'Write 5 propositions.'].join('\n')
  }
  const reference = input.referenceAnswer?.trim()
  const lines = [
    'Request: CLUSTER',
    `Open question: "${collapse(input.question)}"`,
    reference
      ? `Reference answer: "${collapse(reference)}"`
      : 'Reference answer: none given; judge each cluster against established knowledge.',
    'Clusters:',
  ]
  input.clusters.forEach((c, i) => {
    lines.push(`${i}: "${collapse(c.label)}" (${c.count} ${c.count === 1 ? 'answer' : 'answers'})`)
    for (const s of c.samples.slice(0, SAMPLES_PER_CLUSTER)) lines.push(`   - ${collapse(s)}`)
  })
  lines.push('Write 1 to 3 propositions.')
  return lines.join('\n')
}

export const generatorSpec: AgentSpec<GeneratorInput, GeneratorOutput> = {
  name: 'generator',
  version: GENERATOR_VERSION,
  model: DEFAULT_MODEL,
  effort: 'high',
  deadlineMs: DEFAULT_DEADLINE_MS,
  maxTokens: 4096,
  system: SYSTEM,
  userMessage,
  schema: RawCandidates,
  normalize: normalizeGenerator,
  fallback: generatorFallback,
}

export function generateQuestions(
  input: GeneratorInput,
  opts?: RunOptions,
): Promise<AgentResult<GeneratorOutput>> {
  return runAgent(generatorSpec, input, opts)
}
