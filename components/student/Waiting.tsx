import { PriceDisplay } from '@/components/shared/PriceDisplay'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { StudentView } from '@/lib/types'

/** Snapshot phase: nothing to do; the teacher may reveal the blind consensus. */
export function Waiting({ view }: { view: StudentView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reading the room…</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground">{view.question?.proposition}</p>
        {view.my?.pct !== null && view.my?.pct !== undefined && (
          <p className="text-sm">Your number: {view.my.pct}%</p>
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
