'use client'
import { Slider } from '@/components/ui/slider'

/** A 0–100 slider in steps of 5 with a large readout and an optional highlighted band. */
export function BeliefSlider({
  value,
  onChange,
  onCommit,
  band,
  disabled,
}: {
  value: number
  onChange: (pct: number) => void
  onCommit?: (pct: number) => void
  band?: { lo: number; hi: number } | null
  disabled?: boolean
}) {
  const pick = (v: number | readonly number[]) => (Array.isArray(v) ? (v[0] as number) : (v as number))
  return (
    <div className="flex flex-col gap-3">
      <div className="text-center">
        <div className="text-6xl font-semibold tabular-nums">{value}%</div>
        <div className="text-sm text-muted-foreground">confident it is TRUE</div>
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
          aria-label="Confidence that the proposition is true"
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Surely FALSE</span>
        <span>Unsure</span>
        <span>Surely TRUE</span>
      </div>
    </div>
  )
}
