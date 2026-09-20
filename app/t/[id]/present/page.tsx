'use client'
import { QRCodeSVG } from 'qrcode.react'
import { use, useCallback, useMemo } from 'react'
import { Countdown } from '@/components/shared/Countdown'
import { phaseLabel } from '@/components/shared/PhaseBadge'
import { PriceDisplay } from '@/components/shared/PriceDisplay'
import { HistogramBars } from '@/components/teacher/HistogramBars'
import { SocraticArc } from '@/components/teacher/SocraticArc'
import { createApi } from '@/lib/api'
import { isOpenQuestion } from '@/lib/phases/machine'
import { useSessionView } from '@/lib/realtime/useSessionView'
import { useHydrated, useTeacherToken } from '@/lib/storage'
import { PHASES, type Phase } from '@/lib/types'

/** Minimum number of price points before the arc is worth projecting. */
const ARC_MIN_POINTS = 3

function phaseAtLeast(phase: Phase, floor: Phase): boolean {
  return PHASES.indexOf(phase) >= PHASES.indexOf(floor)
}

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

  const open = isOpenQuestion(cur)
  const row = view.questions.find((q) => q.id === cur.questionId) ?? null

  // Cascade demo (plan §17.5): once the blind run was revealed, the two blind
  // numbers side by side while the cascade run is still before its open
  // discussion; from `open` on the live number takes the stage again.
  const cmp = view.cascadeComparison
  const sideBySide =
    cmp !== null && cmp.blindRevealed && cmp.cascadeQuestionId === cur.questionId && !phaseAtLeast(cur.phase, 'open')

  const showPrice = !sideBySide && (cur.pricePct !== null || (cur.blindRevealed && cur.blindPricePct !== null))
  const pct = cur.pricePct ?? (cur.blindRevealed ? cur.blindPricePct : null)
  const label =
    cur.phase === 'blind'
      ? 'Class consensus so far: TRUE'
      : cur.phase === 'open'
        ? 'Class consensus right now: TRUE'
        : cur.phase === 'resolved'
          ? 'Class consensus after debate: TRUE'
          : 'Class consensus before debate: TRUE'

  const sp = cur.surprisinglyPopular

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
          {cur.submissionCount} of {cur.participantCount} have answered.{' '}
          {cur.cascade ? 'The consensus moves as they do.' : 'Nothing is shown until everyone has.'}
        </p>
      )}

      {sideBySide && cmp && (
        <div className="flex flex-col items-center gap-6">
          <div className="flex flex-wrap items-start justify-center gap-x-20 gap-y-6">
            <PriceDisplay pct={cmp.blindPricePct} label="Blind: TRUE" size="xl" />
            <PriceDisplay pct={cmp.cascadePricePct ?? cur.pricePct} label="With the consensus visible: TRUE" size="xl" />
          </div>
          {cmp.gapPct !== null && cmp.reading && <p className="max-w-4xl text-2xl text-muted-foreground">{cmp.reading}</p>}
        </div>
      )}

      {showPrice && <PriceDisplay pct={pct} label={label} size="xl" />}

      {open && phaseAtLeast(cur.phase, 'snapshot') && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-3xl text-muted-foreground">
            {cur.phase === 'resolved' ? 'The next question comes from what the class wrote.' : 'Answers are being read.'}
          </p>
          {cur.clusters.length > 0 && (
            <ul className="flex flex-col gap-2 text-left text-3xl">
              {cur.clusters.map((c) => (
                <li key={c.index}>
                  <span className="font-semibold tabular-nums">{c.count}</span> · {c.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {cur.phase === 'resolved' && !open && (
        <div className="w-full max-w-2xl text-left">
          <p className="mb-3 text-center text-3xl">
            {cur.mode === 'stem' && cur.correctAnswer !== null
              ? `The proposition was ${cur.correctAnswer ? 'TRUE' : 'FALSE'}.`
              : 'No single answer. Here is the distribution.'}
          </p>
          <HistogramBars blind={cur.histogramBlind} current={cur.histogramCurrent} />
          {sp && sp.answer !== null && (
            <p className="mt-4 text-center text-2xl text-muted-foreground">
              Surprisingly popular answer: {sp.answer ? 'TRUE' : 'FALSE'}.
            </p>
          )}
        </div>
      )}

      {cur.phase === 'resolved' && !open && cur.priceHistory.length >= ARC_MIN_POINTS && (
        <div className="w-full max-w-4xl">
          <SocraticArc
            points={cur.priceHistory}
            phaseLog={cur.phaseLog}
            outcome={cur.mode === 'stem' ? cur.correctAnswer : null}
            blindPricePct={row?.blindPricePct ?? cur.blindPricePct}
            postPricePct={row?.postPricePct ?? cur.pricePct}
            mode={cur.mode}
            height={320}
          />
        </div>
      )}

      {cur.phase === 'structured' && (
        <p className="text-3xl text-muted-foreground">Groups are talking. Least sure speaks first.</p>
      )}
    </Screen>
  )
}
