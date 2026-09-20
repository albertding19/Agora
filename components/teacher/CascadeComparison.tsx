import { fmtPct } from '@/components/shared/PriceDisplay'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { TeacherView } from '@/lib/types'

export type CascadeComparisonData = NonNullable<TeacherView['cascadeComparison']>

function fmtGap(gap: number | null): string {
  if (gap === null) return '—'
  const rounded = Math.round(gap)
  return `${rounded > 0 ? '+' : ''}${rounded} points`
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
