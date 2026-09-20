import { fmtPct } from '@/components/shared/PriceDisplay'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { TeacherView } from '@/lib/types'

export type CascadeComparisonData = NonNullable<TeacherView['cascadeComparison']>

/**
 * Signed gap at the one-decimal precision `cascadeReading` applies its
 * thresholds to (12 → "+12 points", -9.6 → "-9.6 points"), so the stat can
 * never contradict the sentence under it.
 */
function fmtGap(gap: number | null): string {
  if (gap === null) return '—'
  const n = Number(gap.toFixed(1))
  return `${n > 0 ? '+' : ''}${n} points`
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

/**
 * Cascade demo (plan §17.5): the same proposition run blind and with the
 * live consensus visible. The gap is herding the class experienced; the
 * reading describes the room, never a student.
 */
export function CascadeComparison({ comparison }: { comparison: CascadeComparisonData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cascade comparison</CardTitle>
        <CardDescription>{comparison.proposition}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Blind" value={fmtPct(comparison.blindPricePct)} />
          <Stat label="With the consensus visible" value={fmtPct(comparison.cascadePricePct)} />
          <Stat label="Gap" value={fmtGap(comparison.gapPct)} />
        </div>
        <p className="text-sm">
          {comparison.reading ?? 'The gap appears once the cascade run reaches its snapshot.'}
        </p>
      </CardContent>
    </Card>
  )
}
