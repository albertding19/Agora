import { PriceDisplay } from '@/components/shared/PriceDisplay'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { StudentView } from '@/lib/types'

/** Snapshot phase: nothing to do; the teacher may reveal the blind consensus. */
export function Waiting({ view }: { view: StudentView }) {
  const my = view.my
  // Consider the opposite (plan §17.1): the number on record is the average of the two.
  const blended = my !== null && my.firstPct !== null && my.oppositePct !== null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reading the room…</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground">{view.question?.proposition}</p>
        {my?.pct !== null && my?.pct !== undefined && (
          <p className="text-sm">
            Your number: {my.pct}%{blended ? ` (average of ${my.firstPct}% and ${my.oppositePct}%)` : ''}
          </p>
        )}
        {view.pricePct !== null ? (
          <PriceDisplay pct={view.pricePct} label="Class consensus before debate: TRUE" />
        ) : (
          <p className="text-sm text-muted-foreground">Groups are being formed.</p>
        )}
      </CardContent>
    </Card>
  )
}
