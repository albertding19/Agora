/** Helpers shared by the two view builders. */
import type { SupabaseClient } from '@supabase/supabase-js'
import { PHASES, type LeaderboardRow, type Phase } from '@/lib/types'
import type { ParticipantRow, QuestionRow, SessionRow } from '@/lib/db/types'
import { listSubmissionsForQuestions } from '@/lib/db/queries'
import { rankLeaderboard } from '@/lib/scoring/leaderboard'
import { roundPct } from '@/lib/market/lmsr'

export function phaseIndex(phase: Phase): number {
  return PHASES.indexOf(phase)
}

export function phaseAtLeast(phase: Phase, floor: Phase): boolean {
  return phaseIndex(phase) >= phaseIndex(floor)
}

export function round1(v: number | null): number | null {
  return v === null ? null : roundPct(v, 1)
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

/**
 * Session leaderboard: per student, mean calibration (final number) and mean
 * persuasion over resolved STEM questions. Ranked by lib/scoring/leaderboard.
 * Wealth is not an input and must never become one.
 */
export async function sessionLeaderboard(
  client: SupabaseClient,
  participants: readonly ParticipantRow[],
  questions: readonly QuestionRow[],
): Promise<LeaderboardRow[]> {
  const resolved = questions.filter((qu) => qu.phase === 'resolved' && qu.mode === 'stem')
  const subs = await listSubmissionsForQuestions(
    client,
    resolved.map((qu) => qu.id),
  )
  const cal = new Map<string, number[]>()
  const per = new Map<string, number[]>()
  for (const s of subs) {
    if (s.calibration_final !== null) cal.set(s.participant_id, [...(cal.get(s.participant_id) ?? []), s.calibration_final])
    if (s.persuasion !== null) per.set(s.participant_id, [...(per.get(s.participant_id) ?? []), s.persuasion])
  }
  return rankLeaderboard(
    participants.map((p) => ({
      name: p.display_name,
      calibration: round1(mean(cal.get(p.id) ?? [])),
      persuasion: round1(mean(per.get(p.id) ?? [])),
    })),
  )
}

export function joinUrlFor(session: SessionRow): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  return `${base}/join?code=${session.code}`
}
