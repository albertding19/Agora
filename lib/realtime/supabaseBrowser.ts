/**
 * Browser-side Supabase client used only for the Realtime subscription on
 * `session_ticks`. Returns null when the public env vars are unset or during
 * server rendering; the app keeps working on polling alone.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null | undefined

export function supabaseBrowser(): SupabaseClient | null {
  if (typeof window === 'undefined') return null
  if (client !== undefined) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    client = null
    return null
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return client
}
