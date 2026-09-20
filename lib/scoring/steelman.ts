/**
 * Steelman gate (plan §17.7). Before the structured round each student writes
 * the other side's best argument; the side is never stored, it is derived from
 * the blind number: FALSE for a student leaning TRUE, TRUE for a student
 * leaning FALSE, and EITHER (their pick) for a student at exactly 50 or with
 * no number. The grading agent lives in `lib/agents/steelman.ts`; this file
 * is only the side rule so every call site agrees.
 */
import type { SteelmanSide } from '@/lib/types'
import { lean } from './surprisinglyPopular'

export function steelmanSideFor(blindPct: number | null | undefined): SteelmanSide {
  const own = lean(blindPct)
  if (own === null) return 'EITHER'
  return own ? 'FALSE' : 'TRUE'
}
