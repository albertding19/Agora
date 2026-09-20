/**
 * Confidence proposer (P0). Reads a student's one or two sentences about a
 * proposition and proposes a confidence band. The student always owns the
 * final number: this only proposes, and the slider is usable before the
 * call returns.
 *
 * Callers skip the call entirely when the reasoning text is empty.
 */
import { z } from 'zod'
import { LANGUAGE_RULE, findBannedWord } from '@/lib/language'
import type { Band } from '@/lib/types'
import {
  DEFAULT_DEADLINE_MS,
  DEFAULT_MODEL,
  PROMPT_TAIL,
  runAgent,
  snap5,
  type AgentResult,
  type AgentSpec,
  type RunOptions,
} from './run'

export interface ProposerInput {
  proposition: string
  reasoning: string
}

export const PROPOSER_VERSION = 1
export const MIN_BAND_WIDTH = 15
export const READING_MAX_CHARS = 140

export const NEUTRAL_READING = 'Here is a band for how sure you sounded. Set your own number.'
export const FALLBACK_BAND: Band = {
  stance: 'UNCLEAR',
  lo: 40,
  hi: 60,
  reading: "I couldn't read a clear lean. Set your own number.",
}

/** Raw model output. Plain types only; ranges are enforced in normalize. */
const RawProposal = z.object({
  stance: z.enum(['TRUE', 'FALSE', 'UNCLEAR']),
  lo: z.number(),
  hi: z.number(),
  reading: z.string(),
})

/**
 * Normalize a raw proposal into a valid Band:
 *  - lo/hi snapped to multiples of 5 and clamped to 0-100, ordered
 *  - a FALSE stance with a band above 50 (or TRUE below 50) is read as
 *    "that sure of the other side" and mirrored
 *  - UNCLEAR forces 40-60
 *  - width widened symmetrically to at least 15
 *  - reading truncated to 140 chars; replaced if empty or it breaks the language rule
 * Returns null only if the raw shape is unusable.
 */
export function normalizeProposal(raw: unknown): Band | null {
  const parsed = RawProposal.safeParse(raw)
  if (!parsed.success) return null
  const { stance } = parsed.data
  let { lo, hi, reading } = parsed.data
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null

  lo = snap5(lo)
  hi = snap5(hi)
  if (lo > hi) [lo, hi] = [hi, lo]

  if (stance === 'UNCLEAR') {
    lo = 40
    hi = 60
  } else {
    if (stance === 'FALSE' && lo >= 50) [lo, hi] = [100 - hi, 100 - lo]
    if (stance === 'TRUE' && hi <= 50) [lo, hi] = [100 - hi, 100 - lo]
    let guard = 0
    while (hi - lo < MIN_BAND_WIDTH && guard++ < 40) {
      if (lo > 0) lo -= 5
      if (hi - lo < MIN_BAND_WIDTH && hi < 100) hi += 5
      if (lo === 0 && hi === 100) break
    }
  }

  reading = reading.trim().replace(/\s+/g, ' ').slice(0, READING_MAX_CHARS)
  if (!reading || findBannedWord(reading)) reading = NEUTRAL_READING

  return { stance, lo, hi, reading }
}

const SYSTEM = [
  'You are the confidence proposer inside Agora, a classroom tool that measures what a class believes and how confidently.',
  'A student has written one or two sentences about a proposition. Read them and propose a confidence band. You only propose; the student sets the final number.',
  'Rules:',
  '- stance: the side the student took. TRUE if they argue the proposition holds, FALSE if they argue it does not, UNCLEAR if the text takes no side or is too thin to read.',
  '- lo and hi: the student\'s probability, as a percent, that the proposition is TRUE. Use multiples of 5 and make the band at least 15 wide.',
  '- Confident wording ("obviously", "definitely", "for sure") means a narrower band near the extreme for that side. Hedged wording ("I think", "maybe", "not sure") means a wider band closer to 50. A bare number like "80%" is their probability that it is TRUE.',
  '- reading: one sentence in the second person, at most 140 characters, that restates what they said and how sure they sounded, so they can catch a misread. Example: "You said the ball costs 10 cents, and you sounded very sure."',
  '- Never say whether the proposition is actually true, never correct the student, never give the answer.',
  `- ${LANGUAGE_RULE}`,
  PROMPT_TAIL,
].join('\n')

export const proposerSpec: AgentSpec<ProposerInput, Band> = {
  name: 'proposer',
  version: PROPOSER_VERSION,
  model: DEFAULT_MODEL,
  effort: 'low',
  deadlineMs: DEFAULT_DEADLINE_MS,
  maxTokens: 2048,
  system: SYSTEM,
  userMessage: ({ proposition, reasoning }) =>
    `Proposition: "${proposition.trim()}"\nStudent wrote: "${reasoning.trim()}"`,
  schema: RawProposal,
  normalize: normalizeProposal,
  fallback: () => ({ ...FALLBACK_BAND }),
}

export function proposeBand(input: ProposerInput, opts?: RunOptions): Promise<AgentResult<Band>> {
  return runAgent(proposerSpec, input, opts)
}
