'use client'

/**
 * Most convincing arguments (plan §17.9b). Dashboard only: the rows carry a
 * comparison count, which is teacher-only information; the projector and
 * the phones never see it.
 *
 * The ranking is a Bradley–Terry strength from pairwise comparisons on the
 * phones, never a popularity tally. Every text is anonymous; `side` is the
 * argument's blind lean, an aggregate-safe hint, never a name.
 */
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { TeacherView } from '@/lib/types'

function clampPct(v: number): number {
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0
}

export function TopArguments({ current }: { current: NonNullable<TeacherView['current']> }) {
  const { topArguments, argumentVotersPct } = current
  if (topArguments.length === 0 && argumentVotersPct === null) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Most convincing arguments</CardTitle>
        <CardDescription>
          Ranked by pairwise comparison on the phones (Bradley–Terry), not by popularity.
          {argumentVotersPct !== null &&
            ` ${Math.round(argumentVotersPct)}% of the class has compared at least one pair.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {topArguments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No comparisons yet. Students see pairs of arguments on their phones after resolution.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {topArguments.map((a, i) => (
              <li key={`${i}-${a.text}`} className="grid grid-cols-[1.5rem_1fr] gap-2">
                <span className="text-sm font-medium tabular-nums text-muted-foreground">{i + 1}</span>
                <div className="flex flex-col gap-1">
                  <p className="text-sm">“{a.text}”</p>
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-sm bg-muted">
                      <div className="h-2 rounded-sm bg-primary" style={{ width: `${clampPct(a.winPct)}%` }} />
                    </div>
                    <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      wins {Math.round(clampPct(a.winPct))}% of comparisons
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {a.side !== null && <Badge variant="outline">argued {a.side}</Badge>}
                    <span className="tabular-nums">
                      {a.comparisons} {a.comparisons === 1 ? 'comparison' : 'comparisons'}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
