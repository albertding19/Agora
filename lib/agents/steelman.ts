/**
 * Steelman grader (plan §17.7). Before the structured round each student
 * writes the other side's best argument in one sentence; this agent grades
 * how faithfully that sentence states the assigned side's case. Fidelity
 * only: never truth, never style.
 *
 * Per-student burst like the proposer (effort low, 8 s deadline). Callers
 * pass `{ cache }` so identical text on a re-submission is a cache hit, and
 * the route stores the graded fidelity on the submission.
 */
import { z } from 'zod'
import { LANGUAGE_RULE, findBannedWord } from '@/lib/language'
import type { SteelmanSide } from '@/lib/types'
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

export interface SteelmanInput {
  proposition: string
  /** The side the student was asked to argue for: the side they lean against, or EITHER at 50. */
  side: SteelmanSide
  /** The student's one-sentence steelman (≤ 200 chars at the route). */
  text: string
}

export interface SteelmanOutput {
  /** 0-100 in steps of 5; null only on fallback (never rewards nor punishes). */
  fidelity: number | null
  /** One second-person sentence, ≤ 140 chars, on what would make the steelman stronger. */
  note: string
}

export const STEELMAN_VERSION = 1
export const NOTE_MAX_CHARS = 140

export const NEUTRAL_NOTE = 'Graded on how faithfully you stated the other side.'
export const FALLBACK_NOTE = 'Saved, but it could not be graded right now. Try again in a moment.'

/** Raw model output. Plain types only; the range is enforced in normalize. */
const RawSteelman = z.object({
  fidelity: z.number(),
  note: z.string(),
})

/** The plan forbids the note from calling the student "wrong"; enforced here, not only in the prompt. */
const WRONG_PATTERN = /\bwrong\b/i

/** Collapse runs of whitespace (newlines included) into single spaces and trim. */
function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/**
 * Truncate to `max` UTF-16 units without splitting a surrogate pair: a cut
 * that lands between the halves of an emoji would leave a lone surrogate,
 * which is not valid UTF-8 once it reaches Postgres or a phone.
 */
function truncate(text: string, max: number): string {
  const out = text.slice(0, max)
  const last = out.charCodeAt(out.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out
}

/**
 * Normalize a raw grade into a SteelmanOutput:
 *  - fidelity snapped to a multiple of 5 and clamped to 0-100
 *  - note trimmed, whitespace collapsed, truncated to 140 chars
 *  - note replaced by NEUTRAL_NOTE if empty, if it breaks the language rule,
 *    or if it uses the word "wrong" (the note never labels the student)
 * Returns null only if the raw shape is unusable (bad shape, non-finite fidelity).
 */
export function normalizeSteelman(raw: unknown): SteelmanOutput | null {
  const parsed = RawSteelman.safeParse(raw)
  if (!parsed.success) return null
  const { fidelity } = parsed.data
  if (!Number.isFinite(fidelity)) return null

  let note = truncate(oneLine(parsed.data.note), NOTE_MAX_CHARS)
  if (!note || findBannedWord(note) || WRONG_PATTERN.test(note)) note = NEUTRAL_NOTE

  return { fidelity: snap5(fidelity), note }
}

const SYSTEM = [
  'You are the steelman grader inside Agora, a classroom tool that measures what a class believes and how confidently.',
  'Before a debate, each student is asked to write, in one sentence, the best case for the side of a proposition they lean against. You grade how faithfully and charitably the sentence states the best case for the assigned side, as that side\'s own proponents would state it.',
  'Grade fidelity only. Do not grade whether the proposition is true, and do not grade writing style, grammar, or length.',
  'Rules:',
  '- fidelity: a number from 0 to 100 in steps of 5.',
  '  90-100: the strongest known argument for the assigned side, stated accurately and charitably.',
  '  60-85: a real argument for the assigned side, but with a gap, a missing step, or a slight caricature.',
  '  30-55: vague, generic, or mostly restates the proposition or its negation without giving a reason.',
  '  0-25: argues the student\'s own side instead, mocks or dismisses the assigned side, or is off topic.',
  '- If the assigned side is EITHER, the student sat at 50 and may pick a side: grade whichever side the sentence argues for.',
  '- note: one sentence in the second person, at most 140 characters, on what would make the steelman stronger. Example: "You named the conclusion; add the step that gets there."',
  '- The note must never reveal or hint at the answer, never say which side is right, and never use the word "wrong".',
  `- ${LANGUAGE_RULE}`,
  PROMPT_TAIL,
].join('\n')

function sideLine(side: SteelmanSide): string {
  if (side === 'EITHER') return 'Assigned side: EITHER (grade whichever side the sentence argues for)'
  return `Assigned side: the proposition is ${side}`
}

export const steelmanSpec: AgentSpec<SteelmanInput, SteelmanOutput> = {
  name: 'steelman',
  version: STEELMAN_VERSION,
  model: DEFAULT_MODEL,
  effort: 'low',
  deadlineMs: DEFAULT_DEADLINE_MS,
  maxTokens: 2048,
  system: SYSTEM,
  // The student's text is flattened to one line so a newline inside it can
  // never forge a second "Assigned side:" line in the prompt.
  userMessage: ({ proposition, side, text }) =>
    `Proposition: "${oneLine(proposition)}"\n${sideLine(side)}\nStudent wrote: "${oneLine(text)}"`,
  schema: RawSteelman,
  normalize: normalizeSteelman,
  // Fidelity is null, not 50: a fallback must neither reward nor punish, and
  // null is excluded from the mean the same way a null persuasion is. The
  // dbCache never serves fallbacks, so the student can simply try again.
  fallback: () => ({ fidelity: null, note: FALLBACK_NOTE }),
}

export function gradeSteelman(input: SteelmanInput, opts?: RunOptions): Promise<AgentResult<SteelmanOutput>> {
  return runAgent(steelmanSpec, input, opts)
}
