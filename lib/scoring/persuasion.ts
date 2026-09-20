/**
 * Persuasion score per student within a debate group (STEM only).
 *
 * For student i, take every other member j who submitted a blind number and
 * measure how far j moved toward the truth during the debate:
 *   move_j = sign(outcome) · (final_j − blind_j)       (points; sign = +1 for TRUE, −1 for FALSE)
 *   m_i    = mean(move_j)
 * i is *credited* when their blind number was at least as close to the truth
 * as the group's mean blind distance (the relatively-correct members). This
 * keeps a unanimously wrong group from having no persuader at all. Credited
 * students score m_i; everyone else scores min(0, m_i), i.e. only the penalty
 * for dragging the group the wrong way.
 *
 * Returns null for non-submitters, for groups with fewer than two submitters,
 * and (by the caller) for humanities questions.
 */

export interface GroupMemberScores {
  participantId: string
  blindPct: number | null
  finalPct: number | null
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

export function persuasionScores(
  members: readonly GroupMemberScores[],
  outcome: boolean,
): Map<string, number | null> {
  const result = new Map<string, number | null>()
  for (const m of members) result.set(m.participantId, null)

  const scored = members.filter(
    (m): m is GroupMemberScores & { blindPct: number } => typeof m.blindPct === 'number',
  )
  if (scored.length < 2) return result

  const sign = outcome ? 1 : -1
  const truth = outcome ? 100 : 0
  const meanDistance = mean(scored.map((m) => Math.abs(m.blindPct - truth)))

  for (const i of scored) {
    const moves = scored
      .filter((j) => j.participantId !== i.participantId)
      .map((j) => sign * ((j.finalPct ?? j.blindPct) - j.blindPct))
    const m = mean(moves)
    const credited = Math.abs(i.blindPct - truth) <= meanDistance
    result.set(i.participantId, credited ? m : Math.min(0, m))
  }
  return result
}
