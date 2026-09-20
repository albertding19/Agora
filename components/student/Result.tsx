'use client'
import { PriceDisplay } from '@/components/shared/PriceDisplay'
import { ArgumentDuel } from '@/components/student/ArgumentDuel'
import { Leaderboard } from '@/components/teacher/Leaderboard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Api } from '@/lib/api'
import type { StudentView } from '@/lib/types'

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toFixed(0)
}

function fmtSigned(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(0)}`
}

function fmtPlus(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `+${v.toFixed(0)}`
}

interface Tile {
  key: string
  value: string
  label: string
}

/**
 * Resolved: outcome, calibration before and after, persuasion, top of the
 * leaderboard. Extension tiles (steelman, contrarian credit) and the
 * surprisingly popular reveal appear only when the session's flags are on,
 * so the P0 screen is unchanged with every flag off. Aggregates and the
 * student's own numbers only; never another student's number.
 */
export function Result({
  view,
  api,
  participantId,
  onMutated,
}: {
  view: StudentView
  api: Api
  participantId: string
  onMutated: () => void
}) {
  const r = view.result
  const mode = view.question?.mode
  const outcome = r?.outcome ?? null
  const noSingleAnswer = mode === 'humanities' || outcome === null

  // Calibration, persuasion and contrarian credit need an answer key, so they
  // are STEM-only. The steelman (§17.7) was graded and shown live during the
  // debate, so a humanities question keeps its tile when one was written.
  const stem = mode !== 'humanities'
  const tiles: Tile[] = r
    ? [
        ...(stem
          ? [
              { key: 'calibration', value: fmt(r.calibrationFinal), label: 'calibration' },
              { key: 'before', value: fmt(r.calibrationBlind), label: 'before debate' },
              { key: 'persuasion', value: fmtSigned(r.persuasion), label: 'persuasion' },
            ]
          : []),
        ...(view.features.steelman && (stem || r.steelman !== null)
          ? [{ key: 'steelman', value: fmt(r.steelman), label: 'steelman' }]
          : []),
        ...(view.features.contrarianCredit && stem
          ? [{ key: 'contrarian', value: fmtPlus(r.contrarianBonus), label: 'contrarian credit' }]
          : []),
      ]
    : []
  const tileCols = tiles.length === 1 ? 'grid-cols-1' : tiles.length > 3 ? 'grid-cols-2' : 'grid-cols-3'

  const sp = r?.surprisinglyPopular ?? null
  const spWord = sp && sp.answer !== null ? (sp.answer ? 'TRUE' : 'FALSE') : null
  const showDuel = r !== null && (r.argumentPairs.length > 0 || r.argumentVotesCast > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {noSingleAnswer ? 'No single answer. Here is where the class landed.' : `The proposition was ${outcome ? 'TRUE' : 'FALSE'}.`}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-muted-foreground">{view.question?.proposition}</p>
        <PriceDisplay pct={view.pricePct} label="Class consensus after debate: TRUE" />
        {tiles.length > 0 && (
          <div className={`grid gap-2 text-center ${tileCols}`}>
            {tiles.map((tile) => (
              <div key={tile.key} className="rounded-lg bg-muted p-3">
                <div className="text-2xl font-semibold tabular-nums">{tile.value}</div>
                <div className="text-xs text-muted-foreground">{tile.label}</div>
              </div>
            ))}
          </div>
        )}
        {view.my?.pct !== null && view.my?.pct !== undefined && (
          <p className="text-center text-sm text-muted-foreground">Your final number: {view.my.pct}%</p>
        )}
        {sp && (
          <div className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
            {spWord === null ? (
              <p className="text-muted-foreground">Not enough predictions for a surprisingly popular answer.</p>
            ) : (
              <>
                <p className="font-medium">
                  {noSingleAnswer
                    ? `No answer key. Surprisingly popular answer: ${spWord}.`
                    : `Surprisingly popular answer: ${spWord} — ${sp.answer === outcome ? 'it was right.' : 'it was wrong this time.'}`}
                </p>
                {sp.actualTruePct !== null && sp.predictedTruePct !== null && (
                  <p className="text-muted-foreground">
                    The class expected {sp.predictedTruePct.toFixed(0)}% to say TRUE; {sp.actualTruePct.toFixed(0)}% did.
                  </p>
                )}
              </>
            )}
            {/* On STEM the insight is referenced to the outcome, not the SP answer, so it
                stands even when too few predictions came in for an SP answer. */}
            {sp.insight === true && (
              <p>You knew something the crowd didn&apos;t: you were right and expected most of the class to disagree.</p>
            )}
          </div>
        )}
        {showDuel && <ArgumentDuel view={view} api={api} participantId={participantId} onMutated={onMutated} />}
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
