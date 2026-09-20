/**
 * The demo preset: which flags the seeded session runs with and the timers
 * derived from them. Kept apart from scripts/seed-demo.ts, which runs main()
 * at import, so the preset can be unit-tested (scripts/demo-preset.test.ts).
 */
import type { FeaturesPatchBody, Timers } from '../lib/types'

/**
 * The flags the demo runs with. Edit here; the dashboard's settings card can
 * also toggle them between questions, since views read them live. Pitch line
 * for this preset: "Two questions from MIT research, one from Socrates."
 */
export const DEMO_FEATURES: FeaturesPatchBody = {
  considerOpposite: true,
  predictClass: true,
  socrates: true,
  steelman: false,
  contrarianCredit: false,
  argumentElo: false,
}

/**
 * Blind window for the demo. The P0 blind screen alone (reason, proposer
 * band, slider) needs 60 s (plan §4); §17.1 "consider the opposite" adds a
 * second screen and ~30 s on top, and the lazy advance cannot be extended
 * once the phase has started, so the preset must budget for it up front.
 * 75 s is the product default (app/api/sessions/route.ts DEFAULT_TIMERS),
 * chosen over 90 s to keep three questions under ten minutes.
 */
export const DEMO_BLIND_SECONDS = { withOpposite: 75, withoutOpposite: 60 } as const

/** Fast preset: three questions in under ten minutes. Derived from the flags. */
export function demoTimers(features: FeaturesPatchBody): Timers {
  return {
    blindSeconds: features.considerOpposite ? DEMO_BLIND_SECONDS.withOpposite : DEMO_BLIND_SECONDS.withoutOpposite,
    turnSeconds: 20,
    openSeconds: 45,
  }
}

export const DEMO_TIMERS: Timers = demoTimers(DEMO_FEATURES)
