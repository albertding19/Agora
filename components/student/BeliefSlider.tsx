'use client'
import { Slider } from '@/components/ui/slider'

const DEFAULT_LABEL = 'confident it is TRUE'

/**
 * A 0–100 slider in steps of 5 with a large readout and an optional highlighted
 * band. `compact` shrinks the readout and drops the end labels (used for the
 * "predict the class" slider, plan §17.2); `label` is the caption under the number.
 */
export function BeliefSlider({
  value,
  onChange,
  onCommit,
  band,
  disabled,
  label = DEFAULT_LABEL,
  compact = false,
}: {
  value: number
  onChange: (pct: number) => void
  onCommit?: (pct: number) => void
  band?: { lo: number; hi: number } | null
  disabled?: boolean
  label?: string
  compact?: boolean
}) {
  const pick = (v: number | readonly number[]) => (Array.isArray(v) ? (v[0] as number) : (v as number))
  return (
    <div className={compact ? 'flex flex-col gap-2' : 'flex flex-col gap-3'}>
      <div className="text-center">
        <div className={compact ? 'text-3xl font-semibold tabular-nums' : 'text-6xl font-semibold tabular-nums'}>{value}%</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </div>
      <div className="relative px-1">
        {band && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-primary/20"
            style={{ left: `${band.lo}%`, width: `${Math.max(0, band.hi - band.lo)}%` }}
          />
        )}
        <Slider
          value={[value]}
          min={0}
          max={100}
          step={5}
          disabled={disabled}
          onValueChange={(v) => onChange(pick(v))}
          onValueCommitted={(v) => onCommit?.(pick(v))}
          aria-label={label === DEFAULT_LABEL ? 'Confidence that the proposition is true' : label}
        />
      </div>
      {!compact && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Surely FALSE</span>
          <span>Unsure</span>
          <span>Surely TRUE</span>
        </div>
      )}
    </div>
  )
}
