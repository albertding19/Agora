'use client'
import { QRCodeSVG } from 'qrcode.react'
import { use, useCallback, useMemo } from 'react'
import { Countdown } from '@/components/shared/Countdown'
import { phaseLabel } from '@/components/shared/PhaseBadge'
import { PriceDisplay } from '@/components/shared/PriceDisplay'
import { HistogramBars } from '@/components/teacher/HistogramBars'
import { createApi } from '@/lib/api'
import { useSessionView } from '@/lib/realtime/useSessionView'
import { useHydrated, useTeacherToken } from '@/lib/storage'

/**
 * Projector view: same view model as the dashboard, no controls, and the
 * consensus is only shown when the phase (or an explicit reveal) allows it.
 * The token comes from localStorage, never from the URL.
 */
export default function PresentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params)
  const hydrated = useHydrated()
  const token = useTeacherToken(sessionId)

  if (!hydrated) return <Screen>Loading…</Screen>
  if (!token) {
    return <Screen>Open the projector view from the same browser as the dashboard.</Screen>
  }
  return <Present sessionId={sessionId} token={token} />
}

function Screen({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-8 px-8 py-10 text-center">{children}</main>
}

function Present({ sessionId, token }: { sessionId: string; token: string }) {
  const api = useMemo(() => createApi({ teacherToken: token }), [token])
  const fetcher = useCallback(() => api.teacherView(sessionId), [api, sessionId])
  const { view, error } = useSessionView(fetcher, sessionId)

  if (!view) return <Screen>{error ? `Could not load: ${error}` : 'Connecting…'}</Screen>
  const cur = view.current

  if (!cur) {
    return (
      <Screen>
        <h1 className="text-5xl font-semibold">{view.session.title}</h1>
        <p className="text-2xl text-muted-foreground">Join at {view.session.joinUrl}</p>
        <QRCodeSVG value={view.session.joinUrl} size={280} />
        <div className="text-8xl font-semibold tracking-widest">{view.session.code}</div>
        <p className="text-xl text-muted-foreground">{view.participants.length} joined</p>
      </Screen>
    )
  }

  const showPrice = cur.pricePct !== null || (cur.blindRevealed && cur.blindPricePct !== null)
  const pct = cur.pricePct ?? (cur.blindRevealed ? cur.blindPricePct : null)
  const label =
    cur.phase === 'open'
      ? 'Class consensus right now: TRUE'
      : cur.phase === 'resolved'
        ? 'Class consensus after debate: TRUE'
        : 'Class consensus before debate: TRUE'

  return (
    <Screen>
      <div className="flex w-full max-w-5xl items-center justify-between text-2xl text-muted-foreground">
        <span>
          Question {cur.index + 1} · {phaseLabel(cur.phase)}
        </span>
        <Countdown endsAt={cur.phaseEndsAt} className="font-mono text-4xl tabular-nums" />
      </div>
      <h1 className="max-w-5xl text-5xl leading-tight font-semibold">{cur.proposition}</h1>

      {cur.phase === 'blind' && (
        <p className="text-3xl text-muted-foreground">
          {cur.submissionCount} of {cur.participantCount} have answered. Nothing is shown until everyone has.
        </p>
      )}

      {showPrice && <PriceDisplay pct={pct} label={label} size="xl" />}

      {cur.phase === 'resolved' && (
        <div className="w-full max-w-2xl text-left">
          <p className="mb-3 text-center text-3xl">
            {cur.mode === 'stem' && cur.correctAnswer !== null
              ? `The proposition was ${cur.correctAnswer ? 'TRUE' : 'FALSE'}.`
              : 'No single answer. Here is the distribution.'}
          </p>
          <HistogramBars blind={cur.histogramBlind} current={cur.histogramCurrent} />
        </div>
      )}

      {cur.phase === 'structured' && (
        <p className="text-3xl text-muted-foreground">Groups are talking. Least sure speaks first.</p>
      )}
    </Screen>
  )
}
