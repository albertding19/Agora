export function fmtPct(pct: number | null | undefined, digits = 0): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—'
  return `${pct.toFixed(digits)}%`
}

/** The class consensus that the proposition is TRUE. Never shows anything about wealth. */
export function PriceDisplay({
  pct,
  label = 'Class consensus: TRUE',
  size = 'lg',
}: {
  pct: number | null | undefined
  label?: string
  size?: 'lg' | 'xl'
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={size === 'xl' ? 'text-8xl font-semibold tabular-nums' : 'text-5xl font-semibold tabular-nums'}>
        {fmtPct(pct)}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  )
}
