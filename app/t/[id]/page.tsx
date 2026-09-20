'use client'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'
import { use, useCallback, useMemo, useState } from 'react'
import { Countdown } from '@/components/shared/Countdown'
import { PhaseBadge } from '@/components/shared/PhaseBadge'
import { fmtPct } from '@/components/shared/PriceDisplay'
import { BeliefMap } from '@/components/teacher/BeliefMap'
import { HistogramBars } from '@/components/teacher/HistogramBars'
import { Leaderboard } from '@/components/teacher/Leaderboard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { createApi } from '@/lib/api'
import { useSessionView } from '@/lib/realtime/useSessionView'
import { setTeacherToken, useHydrated, useTeacherToken } from '@/lib/storage'
import type { Mode, TeacherView } from '@/lib/types'

export default function TeacherPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params)
  const hydrated = useHydrated()
  const token = useTeacherToken(sessionId)

  if (!hydrated) return <Frame>Loading…</Frame>
  if (!token) return <Frame><TokenPrompt sessionId={sessionId} /></Frame>
  return (
    <Frame>
      <Dashboard sessionId={sessionId} token={token} />
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">{children}</main>
}

function TokenPrompt({ sessionId }: { sessionId: string }) {
  const [token, setToken] = useState('')
  return (
    <Card>
      <CardHeader>
        <CardTitle>Teacher access</CardTitle>
        <CardDescription>
          Open this page from the browser that created the session, or paste the teacher token.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (token.trim()) setTeacherToken(sessionId, token.trim())
          }}
        >
          <Input placeholder="Teacher token" value={token} onChange={(e) => setToken(e.target.value)} />
          <Button type="submit">Use token</Button>
        </form>
      </CardContent>
    </Card>
  )
}

function Dashboard({ sessionId, token }: { sessionId: string; token: string }) {
  const api = useMemo(() => createApi({ teacherToken: token }), [token])
  const fetcher = useCallback(() => api.teacherView(sessionId), [api, sessionId])
  const { view, error, status, expectTick } = useSessionView(fetcher, sessionId)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(label)
      setActionError(null)
      try {
        await fn()
        expectTick()
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [expectTick],
  )

  if (!view) {
    return <p className="text-muted-foreground">{error ? `Could not load the dashboard: ${error}` : 'Connecting…'}</p>
  }

  const cur = view.current
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{view.session.title}</h1>
          <p className="text-sm text-muted-foreground">
            Join code <span className="font-mono text-base font-semibold tracking-widest">{view.session.code}</span> ·{' '}
            {view.participants.length} joined · realtime: {status}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/t/${sessionId}/present`} target="_blank" className="text-sm underline underline-offset-4">
            Open projector view
          </Link>
        </div>
      </header>

      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {cur ? (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>
                    Question {cur.index + 1}: {cur.proposition}
                  </CardTitle>
                  <span className="flex items-center gap-2">
                    <PhaseBadge phase={cur.phase} />
                    <Countdown endsAt={cur.phaseEndsAt} />
                  </span>
                </div>
                <CardDescription>
                  {cur.mode === 'stem' ? `Answer: ${cur.correctAnswer ? 'TRUE' : 'FALSE'}` : 'Humanities mode: no resolution'} ·{' '}
                  {cur.submissionCount}/{cur.participantCount} submitted
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Controls view={view} busy={busy} run={run} api={api} />
                <div className="grid gap-4 sm:grid-cols-3">
                  <Stat label="Blind consensus" value={fmtPct(cur.blindPricePct)} hint={cur.blindRevealed ? 'revealed to class' : 'teacher only'} />
                  <Stat label="Live consensus" value={fmtPct(cur.pricePct)} hint={cur.phase === 'open' ? 'moving' : ''} />
                  <Stat label="Groups" value={String(cur.groups.length)} hint={cur.clustersStatus === 'ready' ? `${cur.clusters.length} argument clusters` : cur.clustersStatus} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-medium">Beliefs</h3>
                    <HistogramBars blind={cur.histogramBlind} current={cur.histogramCurrent} showCurrent={cur.phase === 'open' || cur.phase === 'resolved'} />
                  </div>
                  <div className="flex flex-col gap-4">
                    <div>
                      <h3 className="mb-2 text-sm font-medium">Argument clusters</h3>
                      {cur.clusters.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {cur.clustersStatus === 'skipped' ? 'Too few written reasons to cluster.' : 'No reasoning clusters yet.'}
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-1 text-sm">
                          {cur.clusters.map((c) => (
                            <li key={c.index}>
                              <span className="font-medium tabular-nums">{c.count}</span> · {c.label}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <h3 className="mb-2 text-sm font-medium">Groups</h3>
                      {cur.groups.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Formed at the snapshot.</p>
                      ) : (
                        <ul className="flex flex-col gap-1 text-sm">
                          {cur.groups.map((g) => (
                            <li key={g.index}>
                              <span className="text-muted-foreground">{g.index + 1}.</span>{' '}
                              {g.turnOrder.join(' → ')}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {cur.narration && <p className="text-sm italic">{cur.narration}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>No question running</CardTitle>
                <CardDescription>Add questions on the right and press Start.</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-6">
                <QRCodeSVG value={view.session.joinUrl} size={160} />
                <div>
                  <div className="text-5xl font-semibold tracking-widest">{view.session.code}</div>
                  <p className="text-sm text-muted-foreground">{view.session.joinUrl}</p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Belief map</CardTitle>
            </CardHeader>
            <CardContent>
              <BeliefMap rows={view.questions} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Leaderboard</CardTitle>
              <CardDescription>Calibration first, then persuasion.</CardDescription>
            </CardHeader>
            <CardContent>
              <Leaderboard rows={view.leaderboard} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <QuestionList view={view} busy={busy} run={run} api={api} />
          <Card>
            <CardHeader>
              <CardTitle>Students ({view.participants.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {view.participants.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody yet. Show the code.</p>
              ) : (
                <ul className="flex flex-wrap gap-1 text-sm">
                  {view.participants.map((p) => (
                    <li key={p.id} className="rounded-md bg-muted px-2 py-0.5">
                      {p.name}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

type Run = (label: string, fn: () => Promise<unknown>) => Promise<void>

function Controls({ view, busy, run, api }: { view: TeacherView; busy: string | null; run: Run; api: ReturnType<typeof createApi> }) {
  const cur = view.current!
  const qid = cur.questionId
  const btn = (label: string, fn: () => Promise<unknown>, variant: 'default' | 'outline' | 'secondary' = 'default') => (
    <Button key={label} variant={variant} disabled={busy !== null} onClick={() => void run(label, fn)}>
      {busy === label ? '…' : label}
    </Button>
  )
  const clustering = btn('Run clustering', () => api.cluster(qid), 'outline')
  switch (cur.phase) {
    case 'blind':
      return <div className="flex flex-wrap gap-2">{btn('End blind phase', () => api.advance(qid, { from: 'blind' }))}</div>
    case 'snapshot':
      return (
        <div className="flex flex-wrap gap-2">
          {!cur.blindRevealed && btn('Reveal blind consensus', () => api.reveal(qid), 'secondary')}
          {clustering}
          {btn('Recompute snapshot', () => api.recomputeSnapshot(qid), 'outline')}
          {btn('Start debate', () => api.advance(qid, { from: 'snapshot' }))}
        </div>
      )
    case 'structured':
      return (
        <div className="flex flex-wrap gap-2">
          {clustering}
          {btn('Open discussion', () => api.advance(qid, { from: 'structured' }))}
        </div>
      )
    case 'open':
      return (
        <div className="flex flex-wrap gap-2">
          {clustering}
          {btn('Resolve', () =>
            api.advance(qid, { from: 'open', ...(cur.mode === 'stem' && cur.correctAnswer !== null ? { correctAnswer: cur.correctAnswer } : {}) }),
          )}
        </div>
      )
    case 'resolved':
      return <p className="text-sm text-muted-foreground">Resolved. Start the next question from the list.</p>
    default:
      return null
  }
}

function QuestionList({ view, busy, run, api }: { view: TeacherView; busy: string | null; run: Run; api: ReturnType<typeof createApi> }) {
  const [proposition, setProposition] = useState('')
  const [mode, setMode] = useState<Mode>('stem')
  const [answer, setAnswer] = useState<boolean>(false)
  const canStart = !view.current || view.current.phase === 'resolved'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Questions</CardTitle>
        <CardDescription>Contestable propositions, one market each.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ol className="flex flex-col gap-2 text-sm">
          {view.questions.map((q) => (
            <li key={q.id} className="flex items-start justify-between gap-2 rounded-md border border-border p-2">
              <div>
                <div>
                  {q.index + 1}. {q.proposition}
                </div>
                <div className="text-xs text-muted-foreground">
                  {q.mode} · {q.mode === 'stem' ? (q.correctAnswer ? 'TRUE' : 'FALSE') : 'no answer'} · {q.phase}
                </div>
              </div>
              {q.phase === 'pending' && (
                <Button
                  size="sm"
                  disabled={!canStart || busy !== null}
                  onClick={() => void run(`start-${q.id}`, () => api.start(view.session.id, { questionId: q.id }))}
                >
                  Start
                </Button>
              )}
            </li>
          ))}
        </ol>
        <form
          className="flex flex-col gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!proposition.trim()) return
            void run('add-question', async () => {
              await api.addQuestions(view.session.id, {
                questions: [{ proposition: proposition.trim(), mode, ...(mode === 'stem' ? { correctAnswer: answer } : {}) }],
              })
              setProposition('')
            })
          }}
        >
          <textarea
            className="min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            placeholder="A contestable proposition, e.g. “The ball costs 10 cents.”"
            value={proposition}
            maxLength={300}
            onChange={(e) => setProposition(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" name="mode" checked={mode === 'stem'} onChange={() => setMode('stem')} /> STEM
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="mode" checked={mode === 'humanities'} onChange={() => setMode('humanities')} /> Humanities
            </label>
            {mode === 'stem' && (
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">Answer:</span>
                <label className="flex items-center gap-1">
                  <input type="radio" name="answer" checked={answer} onChange={() => setAnswer(true)} /> TRUE
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" name="answer" checked={!answer} onChange={() => setAnswer(false)} /> FALSE
                </label>
              </span>
            )}
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={busy !== null || !proposition.trim()}>
            Add question
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
