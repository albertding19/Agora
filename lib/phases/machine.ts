/**
 * Question lifecycle: pure rules and pure transition computations.
 *
 *   pending → blind → snapshot → structured → open → resolved
 *
 * The plan's six beats map as: Blind = blind; Snapshot + Pairing = snapshot
 * (pairing runs inside the transition); Structured round = structured;
 * Open discussion = open; Resolve = resolved. An open *question* (mode
 * 'open', plan §17.3) skips the debate: snapshot → resolved.
 *
 * Nothing in this file touches the database. The DB-aware transition code
 * (lib/phases/advance.ts) calls these functions, writes the results, and
 * flips the phase last with `where phase = <from>` so concurrent callers are
 * safe and a crash mid-transition is retried by the next poll.
 */
import { PHASES, type Mode, type Phase, type PhaseLogEntry, type Timers } from '@/lib/types'
import { pricePct } from '@/lib/market/lmsr'
import { calibrationOrNull } from '@/lib/scoring/calibration'
import { persuasionScores } from '@/lib/scoring/persuasion'
import { contrarianBonus } from '@/lib/scoring/contrarian'
import { spInsight, surprisinglyPopular, type SpResult } from '@/lib/scoring/surprisinglyPopular'
import { pairStudents, type DebateGroup } from '@/lib/pairing/pair'

export const ADVANCE_GRACE_MS = 2000

export function nextPhase(phase: Phase): Phase | null {
  const i = PHASES.indexOf(phase)
  return i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1] : null
}

/**
 * A free-text question (mode 'open', plan §17.3): no number, no price, no
 * debate. Not the `open` *phase*. Use this everywhere instead of comparing
 * the string so every site is greppable.
 */
export function isOpenQuestion(q: { mode: Mode }): boolean {
  return q.mode === 'open'
}

/**
 * Where a transition out of `from` lands. The stored phase order is
 * positional (nextPhase); the one exception is an open question, which has
 * no debate and goes from snapshot straight to resolved.
 */
export function transitionTarget(from: Phase, mode: Mode): Phase | null {
  if (isOpenQuestion({ mode }) && from === 'snapshot') return 'resolved'
  return nextPhase(from)
}

/** When a question first entered `phase` according to its phase log, or null if it never did. */
export function phaseLogAt(log: readonly PhaseLogEntry[], phase: Phase): string | null {
  return log.find((entry) => entry.phase === phase)?.at ?? null
}

export function isTimed(phase: Phase): boolean {
  return phase === 'blind' || phase === 'structured' || phase === 'open'
}

/** Seconds a phase lasts, or null for untimed phases. */
export function phaseDurationSeconds(phase: Phase, timers: Timers, largestGroupSize: number): number | null {
  switch (phase) {
    case 'blind':
      return timers.blindSeconds
    case 'structured':
      return timers.turnSeconds * Math.max(1, largestGroupSize)
    case 'open':
      return timers.openSeconds
    default:
      return null
  }
}

export function largestGroupSize(groups: readonly { turnOrder: readonly string[] }[]): number {
  return groups.reduce((m, g) => Math.max(m, g.turnOrder.length), 1)
}

export function timerExpired(phaseEndsAt: string | Date | null, now: Date, graceMs = ADVANCE_GRACE_MS): boolean {
  if (!phaseEndsAt) return false
  const ends = typeof phaseEndsAt === 'string' ? new Date(phaseEndsAt) : phaseEndsAt
  return now.getTime() >= ends.getTime() + graceMs
}

export interface AutoAdvanceInput {
  phase: Phase
  mode: Mode
  correctAnswer: boolean | null
  phaseEndsAt: string | null
}

/**
 * The phase a timed question should move to on its own, or null.
 * STEM questions never auto-resolve without an answer. An open question is
 * timed only while answers come in (blind); everything after is a teacher click.
 */
export function autoAdvanceTarget(q: AutoAdvanceInput, now: Date, graceMs = ADVANCE_GRACE_MS): Phase | null {
  if (!isTimed(q.phase) || !timerExpired(q.phaseEndsAt, now, graceMs)) return null
  if (isOpenQuestion(q) && q.phase !== 'blind') return null
  if (q.phase === 'open' && q.mode === 'stem' && q.correctAnswer === null) return null
  return transitionTarget(q.phase, q.mode)
}

/** Index into turn_order of who is speaking now (may exceed the group size once all turns are done). */
export function speakerIndex(phaseStartedAt: string | Date, now: Date, turnSeconds: number): number {
  const started = typeof phaseStartedAt === 'string' ? new Date(phaseStartedAt) : phaseStartedAt
  const elapsed = Math.max(0, now.getTime() - started.getTime()) / 1000
  return Math.floor(elapsed / Math.max(1, turnSeconds))
}

// ---------------------------------------------------------------------------
// Transition computations
// ---------------------------------------------------------------------------

export interface SubmissionState {
  participantId: string
  blindPct: number | null
  currentPct: number | null
  /** Predict the class (plan §17.2). Optional so fixtures built as literals keep compiling. */
  predictedTruePct?: number | null
}

/** Price over the numbers students currently hold (current, else blind). Non-submitters are excluded. */
export function livePricePct(submissions: readonly SubmissionState[], budget: number, b: number): number {
  const pcts: number[] = []
  for (const s of submissions) {
    const pct = s.currentPct ?? s.blindPct
    if (pct !== null) pcts.push(pct)
  }
  return pricePct(pcts, budget, b)
}

/** Price over blind numbers only. */
export function blindPricePct(submissions: readonly SubmissionState[], budget: number, b: number): number {
  const pcts = submissions.map((s) => s.blindPct).filter((p): p is number => p !== null)
  return pricePct(pcts, budget, b)
}

/** The surprisingly popular answer over blind numbers and class predictions (plan §17.2). */
function surprisinglyPopularOf(submissions: readonly SubmissionState[]): SpResult {
  return surprisinglyPopular(
    submissions.map((s) => ({ blindPct: s.blindPct, predictedTruePct: s.predictedTruePct ?? null })),
  )
}

export interface SnapshotInput {
  participantIds: readonly string[]
  submissions: readonly SubmissionState[]
  budget: number
  b: number
}

export interface SnapshotResult {
  blindPricePct: number
  groups: DebateGroup[]
  /** Blind-phase data only (frozen by the phase gate), so re-running the snapshot gives the same answer. */
  surprisinglyPopular: SpResult
}

/** blind → snapshot: the blind price, the debate groups, and the surprisingly popular answer. Deterministic. */
export function computeSnapshot(input: SnapshotInput): SnapshotResult {
  const byId = new Map(input.submissions.map((s) => [s.participantId, s]))
  const groups = pairStudents(
    input.participantIds.map((participantId) => ({
      participantId,
      blindPct: byId.get(participantId)?.blindPct ?? null,
    })),
  )
  return {
    blindPricePct: blindPricePct(input.submissions, input.budget, input.b),
    groups,
    surprisinglyPopular: surprisinglyPopularOf(input.submissions),
  }
}

export interface ResolutionInput {
  mode: Mode
  outcome: boolean | null
  budget: number
  b: number
  submissions: readonly SubmissionState[]
  groups: readonly DebateGroup[]
}

export interface ParticipantResolution {
  finalPct: number | null
  calibrationFinal: number | null
  calibrationBlind: number | null
  persuasion: number | null
  /**
   * Knew something the crowd didn't (plan §17.2): own lean matched the
   * reference (the outcome on STEM, the surprisingly popular answer
   * otherwise) while expecting most of the class to disagree. Null when the
   * student, their prediction, or the reference has no lean.
   */
  spInsight: boolean | null
  /** Contrarian credit (plan §17.9a): 0 for scored students who do not qualify, null when not scoreable. */
  contrarianBonus: number | null
}

export interface ResolutionResult {
  postPricePct: number
  perParticipant: Map<string, ParticipantResolution>
}

/** open → resolved: final numbers, post-debate price, and scores. */
export function computeResolution(input: ResolutionInput): ResolutionResult {
  const scoreable = input.mode === 'stem' && input.outcome !== null
  const outcome = input.outcome
  const byId = new Map(input.submissions.map((s) => [s.participantId, s]))
  // Recomputed from the same inputs the snapshot used (`b` is liquidity_b in
  // both transitions), so these equal the stored blind price and sp_* columns.
  const blindPrice = blindPricePct(input.submissions, input.budget, input.b)
  const sp = surprisinglyPopularOf(input.submissions)
  const spReference = input.mode === 'stem' ? outcome : sp.answer

  const perParticipant = new Map<string, ParticipantResolution>()
  for (const s of input.submissions) {
    const finalPct = s.currentPct ?? s.blindPct
    perParticipant.set(s.participantId, {
      finalPct,
      calibrationFinal: scoreable ? calibrationOrNull(finalPct, outcome) : null,
      calibrationBlind: scoreable ? calibrationOrNull(s.blindPct, outcome) : null,
      persuasion: null,
      spInsight: spInsight(s.blindPct, s.predictedTruePct ?? null, spReference),
      contrarianBonus:
        scoreable && outcome !== null && finalPct !== null ? contrarianBonus(s.blindPct, blindPrice, outcome) : null,
    })
  }

  if (scoreable && outcome !== null) {
    for (const g of input.groups) {
      const members = g.turnOrder.map((participantId) => {
        const s = byId.get(participantId)
        return {
          participantId,
          blindPct: s?.blindPct ?? null,
          finalPct: s ? (s.currentPct ?? s.blindPct) : null,
        }
      })
      const scores = persuasionScores(members, outcome)
      for (const [participantId, persuasion] of scores) {
        const existing = perParticipant.get(participantId)
        if (existing) existing.persuasion = persuasion
      }
    }
  }

  const finals = [...perParticipant.values()].map((r) => r.finalPct).filter((p): p is number => p !== null)
  return { postPricePct: pricePct(finals, input.budget, input.b), perParticipant }
}
