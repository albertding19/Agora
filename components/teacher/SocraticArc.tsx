'use client'

/**
 * The Socratic arc (plan §17.6): one question's class consensus drawn
 * confident → aporia (50%) → resolved, with the phases as bands.
 *
 * Teacher surfaces only (dashboard, projector). Never import this under
 * components/student/*: phones never see a price history, and this file
 * pulls Recharts into the bundle.
 *
 * Pure layout. Every number comes from lib/scoring/arc.ts; this component
 * only maps points onto axes. Points are anonymous (no names, ids, or
 * per-student numbers). A point's `note` is never drawn here; the replay
 * caption (components/teacher/Replay.tsx) is the only place it appears.
 *
 * `revealUpTo` (replay) nulls out every point from that index on instead of
 * dropping it, so the x domain stays fixed while the line grows.
 */
import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { HistoryPoint, Mode, Phase, PhaseLogEntry } from '@/lib/types'
import { CONFIDENT_DISTANCE, UNCERTAIN_DISTANCE, arcBands, arcX, describeArc } from '@/lib/scoring/arc'

/** A history point as either view emits it; `note` is optional so the live dashboard's points fit. */
export interface ArcPoint {
  t: string
  pct: number
  phase: Phase
  note?: string | null
}

export interface SocraticArcProps {
  points: ArcPoint[]
  phaseLog: PhaseLogEntry[]
  outcome: boolean | null
  blindPricePct: number | null
  postPricePct: number | null
  mode: Mode
  height?: number
  /** Replay: only the first `revealUpTo` points are drawn; the rest keep their x but no y. */
  revealUpTo?: number
}

export const ARC_EMPTY_TEXT = 'The arc appears once the open discussion starts.'

const MUTED_INK = 'var(--muted-foreground)'
const SMALL_LABEL = { fontSize: 11, fill: MUTED_INK } as const

/** Same thresholds as `describeArc`, so the dot label and the sentence agree. */
function startWord(blindPct: number): 'confident' | 'uncertain' | 'leaning' {
  const distance = Math.abs(Math.round(blindPct) - 50)
  if (distance >= CONFIDENT_DISTANCE) return 'confident'
  if (distance <= UNCERTAIN_DISTANCE) return 'uncertain'
  return 'leaning'
}

export function SocraticArc({
  points,
  phaseLog,
  outcome,
  blindPricePct,
  postPricePct,
  mode,
  height = 240,
  revealUpTo,
}: SocraticArcProps) {
  const history = useMemo<HistoryPoint[]>(
    () => points.map((p) => ({ t: p.t, pct: p.pct, phase: p.phase, note: p.note ?? null })),
    [points],
  )
  const layout = useMemo(() => {
    const x = arcX(history)
    const { bands, resolvedX } = arcBands(history, phaseLog, x.xs)
    return { xMode: x.mode, xs: x.xs, bands, resolvedX }
  }, [history, phaseLog])

  if (history.length < 2) return <p className="text-sm text-muted-foreground">{ARC_EMPTY_TEXT}</p>

  const revealed = (i: number): boolean => revealUpTo === undefined || i < revealUpTo
  const data = history.map((p, i) => ({ x: layout.xs[i], pct: revealed(i) ? p.pct : null }))

  const snapIdx = history.findIndex((p) => p.phase === 'snapshot')
  const resolvedIdx = history.findIndex((p) => p.phase === 'resolved')
  const snapY = blindPricePct ?? (snapIdx >= 0 ? history[snapIdx].pct : null)
  const resolvedY = resolvedIdx >= 0 ? (postPricePct ?? history[resolvedIdx].pct) : null
  const showSnapshot = snapIdx >= 0 && snapY !== null && Number.isFinite(snapY) && revealed(snapIdx)
  const showResolved = resolvedIdx >= 0 && resolvedY !== null && Number.isFinite(resolvedY) && revealed(resolvedIdx)
  const resolvedLabel =
    mode !== 'humanities' && outcome !== null
      ? `resolved: ${outcome ? 'TRUE' : 'FALSE'}`
      : `resolved: ${Math.round(resolvedY ?? 0)}%`

  // The sentence under the chart sees only what the line shows, so a replay
  // never spoils its ending: the blind number waits for the snapshot point,
  // the ending waits for the resolved point.
  const replaying = revealUpTo !== undefined
  const captionPoints = replaying ? history.slice(0, revealUpTo) : history
  const captionBlind = !replaying || snapIdx < 0 || revealed(snapIdx) ? blindPricePct : null
  const captionPost =
    !replaying || (resolvedIdx >= 0 ? revealed(resolvedIdx) : revealUpTo >= history.length) ? postPricePct : null
  const caption = describeArc({ points: captionPoints, blindPricePct: captionBlind, postPricePct: captionPost, outcome, mode })

  const fmtX = (v: number): string => (layout.xMode === 'time' ? `${Math.round(v)}s` : `${v}`)
  const fmtTooltipLabel = (label: unknown): string =>
    layout.xMode === 'time' ? `${Math.round(Number(label))} s in` : `point ${Number(label) + 1}`

  return (
    <div className="flex flex-col gap-2">
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 600, height }}>
        <LineChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            type="number"
            dataKey="x"
            domain={['dataMin', 'dataMax']}
            allowDecimals={false}
            tickFormatter={fmtX}
            tick={SMALL_LABEL}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
          />
          <YAxis
            type="number"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={SMALL_LABEL}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          {layout.bands.map((band, i) => (
            <ReferenceArea
              key={`${band.label}-${band.x1}`}
              x1={band.x1}
              x2={band.x2}
              fill={i % 2 === 0 ? 'var(--chart-1)' : 'var(--muted)'}
              fillOpacity={0.5}
              stroke="none"
              label={{ value: band.label, position: 'insideTop', ...SMALL_LABEL }}
            />
          ))}
          <ReferenceLine
            y={50}
            stroke={MUTED_INK}
            strokeDasharray="4 4"
            label={{ value: 'aporia · 50%', position: 'insideTopRight', ...SMALL_LABEL }}
          />
          {layout.resolvedX !== null && showResolved && (
            <ReferenceLine
              x={layout.resolvedX}
              stroke={MUTED_INK}
              label={{ value: 'Resolved', position: 'insideTopLeft', ...SMALL_LABEL }}
            />
          )}
          {showSnapshot && (
            <ReferenceDot
              x={layout.xs[snapIdx]}
              y={snapY}
              r={4}
              fill="var(--background)"
              stroke="var(--foreground)"
              strokeWidth={2}
              label={{
                value: `${startWord(snapY)}: ${Math.round(snapY)}%`,
                position: 'right',
                ...SMALL_LABEL,
              }}
            />
          )}
          {showResolved && (
            <ReferenceDot
              x={layout.xs[resolvedIdx]}
              y={resolvedY}
              r={4}
              fill="var(--foreground)"
              stroke="var(--background)"
              strokeWidth={2}
              label={{ value: resolvedLabel, position: 'left', ...SMALL_LABEL }}
            />
          )}
          <Tooltip
            cursor={{ stroke: 'var(--border)' }}
            isAnimationActive={false}
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--popover-foreground)',
              fontSize: 12,
            }}
            itemStyle={{ color: 'var(--popover-foreground)' }}
            labelStyle={{ color: MUTED_INK }}
            labelFormatter={fmtTooltipLabel}
            formatter={(value) => [`${Math.round(Number(value))}%`, 'consensus TRUE']}
          />
          <Line
            type="linear"
            dataKey="pct"
            name="consensus"
            stroke="var(--foreground)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: 'var(--foreground)', stroke: 'var(--background)', strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-sm text-muted-foreground">{caption}</p>
    </div>
  )
}
