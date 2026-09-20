/**
 * The language rule from CLAUDE.md §"Hard rules". This is the only file in
 * the repo allowed to contain the banned words; `scripts/lint-language.sh`
 * excludes it and fails the build if any other source file uses one.
 */

export const BANNED_WORDS = [
  'bet',
  'bets',
  'betting',
  'wager',
  'wagers',
  'odds',
  'shares',
  'gamble',
  'gambling',
  'payout',
  'payouts',
] as const

export const PREFERRED_WORDS = ['belief', 'confidence', 'consensus', 'score'] as const

/** Paragraph pasted into every agent system prompt. */
export const LANGUAGE_RULE = [
  `Never use any of these words: ${BANNED_WORDS.join(', ')}.`,
  `Prefer: ${PREFERRED_WORDS.join(', ')}.`,
  'This is a classroom measurement tool, not a game of chance.',
].join(' ')

const BANNED_PATTERN = new RegExp(`\\b(${BANNED_WORDS.join('|')})\\b`, 'i')

/** Returns the first banned word found in `text`, or null. */
export function findBannedWord(text: string): string | null {
  const m = BANNED_PATTERN.exec(text)
  return m ? m[1].toLowerCase() : null
}
