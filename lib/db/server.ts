/**
 * Server-side Supabase client. Uses the secret key, which bypasses row level
 * security, so this module must never be imported from client components
 * (`server-only` makes that a build error) or from `scripts/*` (they go
 * through the HTTP API via lib/api.ts).
 */
import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function db(): SupabaseClient {
  if (cached) return cached
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Copy .env.example to .env.local and fill it in.',
    )
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return cached
}

/**
 * Increment the session's tick so subscribed clients refetch. Call this at
 * the end of every mutating route. Errors are logged, not thrown: a missed
 * poke only costs the 2 s polling latency.
 */
export async function bumpTick(client: SupabaseClient, sessionId: string): Promise<void> {
  const { error } = await client.rpc('bump_tick', { sid: sessionId })
  if (error) console.error('bump_tick failed', sessionId, error.message)
}
