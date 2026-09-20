import { describe, expect, it } from 'vitest'
import { TimersSchema } from '../lib/types'
import { DEMO_BLIND_SECONDS, DEMO_FEATURES, DEMO_TIMERS, demoTimers } from './demo-preset'

describe('demo preset timers', () => {
  it('budgets the P0 blind window plus the §17.1 second screen when considerOpposite is on', () => {
    const t = demoTimers({ considerOpposite: true })
    expect(t.blindSeconds).toBe(DEMO_BLIND_SECONDS.withOpposite)
    // The product default (app/api/sessions/route.ts DEFAULT_TIMERS), not the 45 s that cut judges off.
    expect(t.blindSeconds).toBe(75)
    expect(t.blindSeconds).toBeGreaterThanOrEqual(60 + 15)
  })

  it('uses the P0 blind window when considerOpposite is off or unset', () => {
    expect(demoTimers({ considerOpposite: false }).blindSeconds).toBe(DEMO_BLIND_SECONDS.withoutOpposite)
    expect(demoTimers({}).blindSeconds).toBe(60)
  })

  it('keeps the rest of the fast preset unchanged by the flag', () => {
    const on = demoTimers({ considerOpposite: true })
    const off = demoTimers({ considerOpposite: false })
    expect(on.turnSeconds).toBe(off.turnSeconds)
    expect(on.openSeconds).toBe(off.openSeconds)
    expect(on.blindSeconds).toBeGreaterThan(off.blindSeconds)
  })

  it('derives DEMO_TIMERS from DEMO_FEATURES and satisfies the API contract', () => {
    expect(DEMO_TIMERS).toEqual(demoTimers(DEMO_FEATURES))
    expect(TimersSchema.safeParse(DEMO_TIMERS).success).toBe(true)
    expect(TimersSchema.safeParse(demoTimers({ considerOpposite: false })).success).toBe(true)
  })
})
