'use client'
/**
 * Poll always, poke for speed.
 *
 * Fetches the caller's view on mount, on tab focus, every `pollMs` (2 s), and
 * immediately when Supabase Realtime reports an UPDATE on `session_ticks` for
 * this session. Refetches are debounced 200 ms. `expectTick()` marks that we
 * just mutated; if no tick arrives within 1 s the status becomes 'degraded'
 * (polling still carries the session, the socket just is not delivering).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { noteServerTime } from './clock'
import { supabaseBrowser } from './supabaseBrowser'

export type RealtimeStatus = 'live' | 'polling' | 'degraded' | 'error'

export interface SessionViewState<T> {
  view: T | null
  error: string | null
  status: RealtimeStatus
  refetch: () => void
  /** Call right after a mutation so the UI refreshes and the socket is checked. */
  expectTick: () => void
}

const DEBOUNCE_MS = 200
const EXPECT_TICK_MS = 1000

export function useSessionView<T extends { serverTime: string }>(
  fetcher: () => Promise<T>,
  sessionId: string | null,
  opts: { pollMs?: number } = {},
): SessionViewState<T> {
  const pollMs = opts.pollMs ?? 2000
  const [view, setView] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [degraded, setDegraded] = useState(false)

  const fetcherRef = useRef(fetcher)
  const subscribedRef = useRef(false)
  const inflight = useRef(false)
  const pending = useRef(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs are updated in effects, never during render.
  useEffect(() => {
    fetcherRef.current = fetcher
  }, [fetcher])
  useEffect(() => {
    subscribedRef.current = subscribed
  }, [subscribed])

  const doFetch = useCallback(async () => {
    if (inflight.current) {
      pending.current = true
      return
    }
    inflight.current = true
    try {
      do {
        pending.current = false
        try {
          const next = await fetcherRef.current()
          noteServerTime(next.serverTime)
          setView(next)
          setError(null)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        }
      } while (pending.current)
    } finally {
      inflight.current = false
    }
  }, [])

  const refetch = useCallback(() => {
    if (debounce.current) return
    debounce.current = setTimeout(() => {
      debounce.current = null
      void doFetch()
    }, DEBOUNCE_MS)
  }, [doFetch])

  // Polling, initial fetch, and refetch on tab focus.
  useEffect(() => {
    if (!sessionId) return
    void doFetch()
    const id = setInterval(() => void doFetch(), pollMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      if (debounce.current) {
        clearTimeout(debounce.current)
        debounce.current = null
      }
    }
  }, [sessionId, pollMs, doFetch, refetch])

  // Realtime poke.
  useEffect(() => {
    if (!sessionId) return
    const sb = supabaseBrowser()
    if (!sb) return
    const channel = sb
      .channel(`session:${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'session_ticks', filter: `session_id=eq.${sessionId}` },
        () => {
          if (expectTimer.current) {
            clearTimeout(expectTimer.current)
            expectTimer.current = null
          }
          setDegraded(false)
          refetch()
        },
      )
      .subscribe((status) => {
        setSubscribed(status === 'SUBSCRIBED')
      })
    return () => {
      void sb.removeChannel(channel)
      if (expectTimer.current) {
        clearTimeout(expectTimer.current)
        expectTimer.current = null
      }
    }
  }, [sessionId, refetch])

  const expectTick = useCallback(() => {
    refetch()
    if (!subscribedRef.current) return
    if (expectTimer.current) clearTimeout(expectTimer.current)
    expectTimer.current = setTimeout(() => {
      expectTimer.current = null
      setDegraded(true)
    }, EXPECT_TICK_MS)
  }, [refetch])

  const status: RealtimeStatus = error && !view ? 'error' : !subscribed ? 'polling' : degraded ? 'degraded' : 'live'

  return { view, error, status, refetch, expectTick }
}
