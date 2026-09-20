/**
 * The single agent helper. Every Agora agent is one structured call:
 *
 *   cache lookup → client.messages.parse(...) with a zod output format,
 *   raced against a deadline → normalize → fallback on anything unusable.
 *
 * runAgent never throws. A failed or slow call returns the spec's canned
 * fallback with `fallback: true` and a short `reason`, and every run (ok or
 * not) is logged through the injected cache so the dashboard can show it.
 *
 * Rules baked in (see ARCHITECTURE.md "Agent layer"):
 *   - maxRetries: 0 and a per-request timeout equal to the deadline, so a
 *     retry can never blow the 8 s budget.
 *   - schemas are plain enums / numbers / strings; numeric range constraints
 *     are stripped by the SDK and would only null the parse. Normalize instead.
 *   - no tool_choice, no prefill, no budget_tokens, no explicit thinking
 *     config (claude-opus-5 runs adaptive thinking by default).
 */
import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'

export type Effort = 'low' | 'medium' | 'high'

export interface AgentSpec<I, O> {
  /** Stable name; part of the cache key. */
  name: string
  /** Bump whenever the prompt or schema changes so cached outputs invalidate. */
  version: number
  model: string
  effort: Effort
  deadlineMs: number
  /** Thinking tokens count against this; keep ≥ 2048. */
  maxTokens: number
  system: string
  userMessage(input: I): string
  /** Plain enums / numbers / strings only. */
  schema: z.ZodType
  /** Return null only when the raw output is unusable. */
  normalize(raw: unknown, input: I): O | null
  fallback(input: I): O
}

export interface AgentRunRecord {
  key: string
  agent: string
  version: number
  input: unknown
  output: unknown
  ok: boolean
  fallback: boolean
  latencyMs: number
  model: string
  reason?: string
}

export interface AgentCache {
  get(key: string): Promise<{ output: unknown } | null>
  put(entry: AgentRunRecord): Promise<void>
}

export interface RunOptions {
  cache?: AgentCache
  /** Skip the cache lookup (the run is still logged). Used by agent-eval and pre-warming. */
  bypassCache?: boolean
  client?: Anthropic
}

export interface AgentResult<O> {
  output: O
  fallback: boolean
  cached: boolean
  latencyMs: number
  model: string
  reason?: string
}

export const DEFAULT_MODEL = 'claude-opus-5'
export const DEFAULT_DEADLINE_MS = 8_000

/** "Begin immediately" line appended to every system prompt. */
export const PROMPT_TAIL = 'Begin your answer immediately; keep reasoning brief.'

// ---------------------------------------------------------------------------
// cache key
// ---------------------------------------------------------------------------

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
}

export function cacheKey(agent: string, version: number, input: unknown): string {
  return createHash('sha256').update(canonical({ agent, version, input })).digest('hex')
}

// ---------------------------------------------------------------------------
// client
// ---------------------------------------------------------------------------

let defaultClient: Anthropic | null = null

function getClient(): Anthropic {
  if (!defaultClient) {
    // Credentials resolve from ANTHROPIC_API_KEY (or an `ant auth login` profile).
    defaultClient = new Anthropic({ maxRetries: 0, timeout: DEFAULT_DEADLINE_MS })
  }
  return defaultClient
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIUserAbortError) return 'timeout'
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'timeout'
  if (err instanceof Anthropic.APIError) return `api_${err.status ?? 'error'}`
  if (err instanceof Error) return err.name === 'Error' ? err.message.slice(0, 80) : err.name
  return 'error'
}

// ---------------------------------------------------------------------------
// runAgent
// ---------------------------------------------------------------------------

export async function runAgent<I, O>(
  spec: AgentSpec<I, O>,
  input: I,
  opts: RunOptions = {},
): Promise<AgentResult<O>> {
  const start = Date.now()
  const key = cacheKey(spec.name, spec.version, input)
  const model = spec.model || DEFAULT_MODEL

  if (opts.cache && !opts.bypassCache) {
    try {
      const hit = await opts.cache.get(key)
      if (hit) {
        return { output: hit.output as O, fallback: false, cached: true, latencyMs: Date.now() - start, model }
      }
    } catch (err) {
      console.error(`[agent:${spec.name}] cache get failed`, err)
    }
  }

  let raw: unknown = null
  let reason: string | undefined

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), spec.deadlineMs)
  try {
    const client = opts.client ?? getClient()
    const message = await client.messages.parse(
      {
        model,
        max_tokens: Math.max(2048, spec.maxTokens),
        output_config: { format: zodOutputFormat(spec.schema), effort: spec.effort },
        system: spec.system,
        messages: [{ role: 'user', content: spec.userMessage(input) }],
      },
      { timeout: spec.deadlineMs, signal: controller.signal },
    )
    if (message.stop_reason === 'refusal') reason = 'refusal'
    else if (message.stop_reason === 'max_tokens') reason = 'max_tokens'
    else if (message.parsed_output === null || message.parsed_output === undefined) reason = 'unparseable'
    else raw = message.parsed_output
  } catch (err) {
    reason = describeError(err)
    if (reason !== 'timeout') console.error(`[agent:${spec.name}] call failed: ${reason}`)
  } finally {
    clearTimeout(timer)
  }

  let output: O
  let ok = false
  let fallback = false
  if (raw !== null) {
    const normalized = spec.normalize(raw, input)
    if (normalized === null) {
      reason = 'unusable'
      output = spec.fallback(input)
      fallback = true
    } else {
      output = normalized
      ok = true
    }
  } else {
    output = spec.fallback(input)
    fallback = true
  }

  const latencyMs = Date.now() - start
  if (opts.cache) {
    try {
      await opts.cache.put({
        key,
        agent: spec.name,
        version: spec.version,
        input,
        output,
        ok,
        fallback,
        latencyMs,
        model,
        reason,
      })
    } catch (err) {
      console.error(`[agent:${spec.name}] cache put failed`, err)
    }
  }

  return { output, fallback, cached: false, latencyMs, model, reason }
}

// ---------------------------------------------------------------------------
// small helpers shared by normalizers
// ---------------------------------------------------------------------------

export function clampPct(v: number): number {
  return Math.min(100, Math.max(0, v))
}

export function snap5(v: number): number {
  return clampPct(Math.round(v / 5) * 5)
}
