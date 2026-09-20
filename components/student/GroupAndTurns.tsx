'use client'
import { Countdown } from '@/components/shared/Countdown'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { speakerIndex } from '@/lib/phases/machine'
import { useNow } from '@/lib/realtime/clock'
import type { StudentView } from '@/lib/types'

/** Structured round: who speaks now, computed from the clock. Least sure speaks first. */
export function GroupAndTurns({ view, myName }: { view: StudentView; myName: string }) {
  const t = useNow()
  const group = view.group
  const started = view.phaseStartedAt
  const turnSeconds = group?.turnSeconds ?? 30

  let idx: number | null = null
  let secondsLeftInTurn: number | null = null
  if (t !== null && started) {
    idx = speakerIndex(started, new Date(t), turnSeconds)
    const elapsed = Math.max(0, (t - Date.parse(started)) / 1000)
    secondsLeftInTurn = Math.max(0, Math.ceil(turnSeconds - (elapsed % turnSeconds)))
  }
  const done = group !== null && idx !== null && idx >= group.turnOrder.length
  const speaker = group && idx !== null && !done ? group.turnOrder[idx] : null

  // Socrates agent (plan §17.4): one question per speaker, shown during that
  // speaker's turn only, and only while the session flag is on (the route is
  // not flag-gated, so the phone must be). `speakerIndex` can exceed the
  // group size once the turns are over, so the array is only indexed while
  // `!done`.
  const socratesQuestion = (() => {
    if (!view.features.socrates || !group || idx === null || done) return null
    const q = group.socratesQuestions?.[idx]
    return typeof q === 'string' && q.trim().length > 0 ? q : null
  })()

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Structured round</CardTitle>
          <Countdown endsAt={view.phaseEndsAt} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground">{view.question?.proposition}</p>
        {!group ? (
          <p className="text-sm text-muted-foreground">You are not in a group for this question.</p>
        ) : (
          <>
            <p className="text-sm">
              Your group: {group.members.map((m) => m.name).join(', ')}
            </p>
            {done ? (
              <p className="text-lg font-medium">All turns done. Waiting for other groups…</p>
            ) : (
              <div className="rounded-lg bg-muted p-4 text-center">
                <div className="text-sm text-muted-foreground">Speaking now</div>
                <div className="text-3xl font-semibold">{speaker === myName ? `${speaker} (you)` : (speaker ?? '—')}</div>
                <div className="mt-1 font-mono text-lg tabular-nums">
                  {secondsLeftInTurn === null ? '' : `${secondsLeftInTurn}s`}
                </div>
              </div>
            )}
            {socratesQuestion !== null && (
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Socrates asks</div>
                <p className="mt-1 text-sm leading-snug">{socratesQuestion}</p>
              </div>
            )}
            <ol className="flex flex-col gap-1 text-sm">
              {group.turnOrder.map((name, i) => (
                <li
                  key={`${name}-${i}`}
                  className={
                    i === idx && !done
                      ? 'font-semibold'
                      : idx !== null && i < idx
                        ? 'text-muted-foreground line-through'
                        : 'text-muted-foreground'
                  }
                >
                  {i + 1}. {name}
                  {name === myName ? ' (you)' : ''}
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground">Least sure speaks first. Everyone gets {turnSeconds} seconds.</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
