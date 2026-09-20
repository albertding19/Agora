const BIN_LABELS = ['0–9', '10–19', '20–29', '30–39', '40–49', '50–59', '60–69', '70–79', '80–89', '90–100']

/** Blind vs current beliefs, ten bins, plain CSS bars. */
export function HistogramBars({
  blind,
  current,
  showCurrent = true,
}: {
  blind: number[]
  current: number[]
  showCurrent?: boolean
}) {
  const max = Math.max(1, ...blind, ...(showCurrent ? current : []))
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-muted-foreground/40" /> before debate
        </span>
        {showCurrent && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2 rounded-sm bg-primary" /> now
          </span>
        )}
      </div>
      {BIN_LABELS.map((label, i) => (
        <div key={label} className="grid grid-cols-[3.5rem_1fr] items-center gap-2 text-xs">
          <span className="text-muted-foreground tabular-nums">{label}</span>
          <div className="flex flex-col gap-0.5">
            <div className="h-2 rounded-sm bg-muted-foreground/40" style={{ width: `${(100 * (blind[i] ?? 0)) / max}%` }} />
            {showCurrent && (
              <div className="h-2 rounded-sm bg-primary" style={{ width: `${(100 * (current[i] ?? 0)) / max}%` }} />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
