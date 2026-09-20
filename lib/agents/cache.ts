/**
 * agent_runs-backed cache and run log. Server only.
 *
 * get: most recent successful (ok, not fallback) output for the key.
 * put: append one row per run, successful or not, so the dashboard's
 *      status line can show latency and fallback counts.
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentCache, AgentRunRecord } from './run'

export function dbCache(client: SupabaseClient): AgentCache {
  return {
    async get(key: string) {
      const { data, error } = await client
        .from('agent_runs')
        .select('output')
        .eq('input_hash', key)
        .eq('ok', true)
        .eq('fallback', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) {
        console.error('agent_runs lookup failed', error.message)
        return null
      }
      if (!data || data.output === null || data.output === undefined) return null
      return { output: data.output as unknown }
    },

    async put(entry: AgentRunRecord) {
      const { error } = await client.from('agent_runs').insert({
        agent: entry.agent,
        version: entry.version,
        input_hash: entry.key,
        input: entry.input,
        output: entry.output,
        ok: entry.ok,
        fallback: entry.fallback,
        latency_ms: entry.latencyMs,
        model: entry.model,
      })
      if (error) console.error('agent_runs insert failed', error.message)
    },
  }
}
