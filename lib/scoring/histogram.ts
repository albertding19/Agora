/** Ten bins of beliefs in percent: 0–9, 10–19, …, 90–100. Nulls are skipped. */
export function histogram10(pcts: readonly (number | null | undefined)[]): number[] {
  const bins = new Array<number>(10).fill(0)
  for (const pct of pcts) {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) continue
    const i = Math.min(9, Math.max(0, Math.floor(pct / 10)))
    bins[i] += 1
  }
  return bins
}
