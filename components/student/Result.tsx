import { PriceDisplay } from '@/components/shared/PriceDisplay'
import { Leaderboard } from '@/components/teacher/Leaderboard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { StudentView } from '@/lib/types'

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toFixed(0)
}

/** Resolved: outcome, calibration before and after, persuasion, top of the leaderboard. */
export function Result({ view }: { view: StudentView }) {
  const r = view.result
  const mode = view.question?.mode
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {mode === 'humanities' || r?.outcome === null || r?.outcome === undefined
            ? 'No single answer. Here is where the class landed.'
            : `The proposition was ${r.outcome ? 'TRUE' : 'FALSE'}.`}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-muted-foreground">{view.question?.proposition}</p>
        <PriceDisplay pct={view.pricePct} label="Class consensus after debate: TRUE" />
        {r && mode !== 'humanities' && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted p-3">
              <div className="text-2xl font-semibold tabular-nums">{fmt(r.calibrationFinal)}</div>
              <div className="text-xs text-muted-foreground">calibration</div>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <div className="text-2xl font-semibold tabular-nums">{fmt(r.calibrationBlind)}</div>
              <div className="text-xs text-muted-foreground">before debate</div>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <div className="text-2xl font-semibold tabular-nums">
                {r.persuasion === null ? '—' : `${r.persuasion > 0 ? '+' : ''}${r.persuasion.toFixed(0)}`}
              </div>
              <div className="text-xs text-muted-foreground">persuasion</div>
            </div>
          </div>
        )}
        {view.my?.pct !== null && view.my?.pct !== undefined && (
          <p className="text-center text-sm text-muted-foreground">Your final number: {view.my.pct}%</p>
        )}
        {r && r.leaderboardTop.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium">Top of the class</h3>
            <Leaderboard rows={r.leaderboardTop} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
