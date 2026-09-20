/**
 * Argument clusterer (P0). Groups the free-text reasons for one question into
 * 2-4 clusters, each with a short neutral label. Output is aggregate only:
 * the dashboard shows "12 students: heavier means stronger pull", never who.
 *
 * The caller decides whether to run it at all: skip when fewer than 3
 * reasons exist (the route returns clustersStatus 'skipped').
 * Reasons are passed with short integer indices, never participant ids.
 */
import { z } from 'zod'
import { LANGUAGE_RULE, findBannedWord } from '@/lib/language'
import {
  DEFAULT_DEADLINE_MS,
  DEFAULT_MODEL,
  PROMPT_TAIL,
  runAgent,
  type AgentResult,
  type AgentSpec,
  type RunOptions,
} from './run'

export interface ClustererInput {
  proposition: string
  reasons: { i: number; text: string }[]
}

export interface Cluster {
  label: string
  members: number[]
}

export interface ClustererOutput {
  clusters: Cluster[]
}

export const CLUSTERER_VERSION = 1
export const MIN_CLUSTERS = 2
export const MAX_CLUSTERS = 4
export const LABEL_MAX_CHARS = 60
export const MIN_REASONS_TO_CLUSTER = 3
export const OTHER_LABEL = 'Other'

const RawClusters = z.object({
  clusters: z.array(z.object({ label: z.string(), members: z.array(z.number()) })),
})

/**
 * Normalize raw clusters:
 *  - unknown or duplicate indices dropped (first cluster wins)
 *  - labels trimmed to 60 chars; labels breaking the language rule replaced
 *  - at most 4 clusters; any unassigned indices go into a final "Other"
 *    cluster (displacing the 4th cluster into it if needed)
 *  - empty clusters dropped
 * Returns null if fewer than 2 clusters survive.
 */
export function normalizeClusters(raw: unknown, input: ClustererInput): ClustererOutput | null {
  const parsed = RawClusters.safeParse(raw)
  if (!parsed.success) return null

  const valid = new Set(input.reasons.map((r) => r.i))
  const assigned = new Set<number>()
  const clusters: Cluster[] = []

  for (const c of parsed.data.clusters) {
    const members: number[] = []
    for (const m of c.members) {
      if (!Number.isInteger(m) || !valid.has(m) || assigned.has(m)) continue
      assigned.add(m)
      members.push(m)
    }
    if (members.length === 0) continue
    let label = c.label.trim().replace(/\s+/g, ' ').slice(0, LABEL_MAX_CHARS)
    if (!label || findBannedWord(label)) label = `Argument ${clusters.length + 1}`
    clusters.push({ label, members })
  }

  const leftovers = input.reasons.map((r) => r.i).filter((i) => !assigned.has(i))
  let kept = clusters.slice(0, MAX_CLUSTERS)
  const spill = clusters.slice(MAX_CLUSTERS).flatMap((c) => c.members)
  let other = [...leftovers, ...spill]
  if (other.length > 0 && kept.length >= MAX_CLUSTERS) {
    const displaced = kept[MAX_CLUSTERS - 1]
    kept = kept.slice(0, MAX_CLUSTERS - 1)
    other = [...displaced.members, ...other]
  }
  if (other.length > 0) kept.push({ label: OTHER_LABEL, members: other.sort((a, b) => a - b) })

  if (kept.length < MIN_CLUSTERS) return null
  return { clusters: kept }
}

const SYSTEM = [
  'You are the argument clusterer inside Agora, a classroom tool that measures what a class believes.',
  'You receive a proposition and the short reasons students wrote for their confidence, each with an integer index.',
  'Group the reasons into 2 to 4 clusters by the underlying argument, not merely by which side they take. Two reasons on the same side with different arguments belong in different clusters.',
  'Rules:',
  '- Every index appears in exactly one cluster. Never invent indices.',
  '- label: a short, neutral phrase stating the argument itself, at most 60 characters, e.g. "Heavier means a stronger gravitational pull". Never a judgement like "wrong" or "confused".',
  '- Prefer fewer, cleaner clusters. Put outliers together in a cluster labeled "Other".',
  '- Do not say which side is correct.',
  `- ${LANGUAGE_RULE}`,
  PROMPT_TAIL,
].join('\n')

export const clustererSpec: AgentSpec<ClustererInput, ClustererOutput> = {
  name: 'clusterer',
  version: CLUSTERER_VERSION,
  model: DEFAULT_MODEL,
  effort: 'medium',
  deadlineMs: DEFAULT_DEADLINE_MS,
  maxTokens: 4096,
  system: SYSTEM,
  userMessage: ({ proposition, reasons }) =>
    [
      `Proposition: "${proposition.trim()}"`,
      'Reasons:',
      ...reasons.map((r) => `${r.i}: ${r.text.trim().replace(/\s+/g, ' ')}`),
    ].join('\n'),
  schema: RawClusters,
  normalize: normalizeClusters,
  fallback: () => ({ clusters: [] }),
}

export function clusterReasons(
  input: ClustererInput,
  opts?: RunOptions,
): Promise<AgentResult<ClustererOutput>> {
  return runAgent(clustererSpec, input, opts)
}
