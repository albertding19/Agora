'use client'
/**
 * Server clock offset. Every view response carries `serverTime`; we keep a
 * smoothed offset so countdowns on phones and the projector agree with the
 * server's `phase_ends_at` regardless of local clock drift.
 */
import { useSyncExternalStore } from 'react'

let offsetMs = 0
let samples = 0

export function noteServerTime(iso: string, receivedAt: number = Date.now()): void {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return
  const sample = t - receivedAt
  offsetMs = samples === 0 ? sample : offsetMs * 0.7 + sample * 0.3
  samples += 1
}

/** Server-aligned "now" in epoch milliseconds. */
export function now(): number {
  return Date.now() + offsetMs
}

export function serverOffsetMs(): number {
  return offsetMs
}

const TICK_MS = 250

function subscribeClock(cb: () => void): () => void {
  const id = setInterval(cb, TICK_MS)
  return () => clearInterval(id)
}

/** Server-aligned now, quantized to 250 ms so components re-render on a steady tick. Null during SSR. */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribeClock,
    () => Math.floor(now() / TICK_MS) * TICK_MS,
    () => null,
  )
}

/** Whole seconds until `endsAtIso` (never negative); null when unset or during SSR. */
export function useCountdown(endsAtIso: string | null | undefined): number | null {
  const t = useNow()
  if (t === null || !endsAtIso) return null
  const end = Date.parse(endsAtIso)
  if (!Number.isFinite(end)) return null
  return Math.max(0, Math.ceil((end - t) / 1000))
}

export function formatSeconds(s: number | null): string {
  if (s === null) return '–:––'
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}
