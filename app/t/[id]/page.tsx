'use client'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Countdown } from '@/components/shared/Countdown'
import { PhaseBadge } from '@/components/shared/PhaseBadge'
import { fmtPct } from '@/components/shared/PriceDisplay'
import { ArcCard } from '@/components/teacher/ArcCard'
import { BeliefMap } from '@/components/teacher/BeliefMap'
import { CandidatesPanel, type CandidatesBatch } from '@/components/teacher/CandidatesPanel'
import { CascadeComparison } from '@/components/teacher/CascadeComparison'
import { HistogramBars } from '@/components/teacher/HistogramBars'
import { Leaderboard } from '@/components/teacher/Leaderboard'
import { SessionSettings } from '@/components/teacher/SessionSettings'
import { TopArguments } from '@/components/teacher/TopArguments'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createApi, type Api } from '@/lib/api'
import { isOpenQuestion } from '@/lib/phases/machine'
import { useSessionView } from '@/lib/realtime/useSessionView'
import { setTeacherToken, useHydrated, useTeacherToken } from '@/lib/storage'
import type { Mode, QuestionInput, TeacherQuestionRow, TeacherView } from '@/lib/types'

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

type Current = NonNullable<TeacherView['current']>

/**
 * `tick: false` for calls that read or generate without writing a session
 * tick (sharpen, generate); otherwise the status line would report a missing
 * tick as "degraded".
 */
type Run = (label: string, fn: () => Promise<unknown>, opts?: { tick?: boolean }) => Promise<void>

/** Candidate batches keyed by the open question they came from, or 'topic'. */
type CandidateBatches = Record<string, CandidatesBatch & { version: number }>
const TOPIC_KEY = 'topic'

function Dashboard({ sessionId, token }: { sessionId: string; token: string }) {
  const api = useMemo(() => createApi({ teacherToken: token }), [token])
  const fetcher = useCallback(() => api.teacherView(sessionId), [api, sessionId])
  const { view, error, status, expectTick } = useSessionView(fetcher, sessionId)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<CandidateBatches>({})
  const [socratesBusy, setSocratesBusy] = useState(false)
  const socratesTriggered = useRef<Set<string>>(new Set())

  const run = useCallback<Run>(
    async (label, fn, opts) => {
      setBusy(label)
      setActionError(null)
      try {
        await fn()
        if (opts?.tick !== false) expectTick()
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [expectTick],
  )

  const showCandidates = useCallback((key: string, batch: CandidatesBatch) => {
    setCandidates((prev) => ({ ...prev, [key]: { ...batch, version: (prev[key]?.version ?? 0) + 1 } }))
  }, [])

  // Socrates (plan §17.4) runs outside `run` so the other controls stay usable
  // while up to ten group calls are in flight.
  const prepareSocrates = useCallback(
    async (questionId: string) => {
      setSocratesBusy(true)
      setActionError(null)
      try {
        await api.socrates(questionId)
        expectTick()
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e))
      } finally {
        setSocratesBusy(false)
      }
    },
    [api, expectTick],
  )

  // Auto-trigger once per question at the snapshot; the ref set also stops
  // strict-mode double fires and the 2 s poll from re-firing.
  const cur = view?.current ?? null
  const socratesOn = view?.session.features.socrates ?? false
  const curId = cur?.questionId ?? null
  const curPhase = cur?.phase ?? null
  const curStatus = cur?.socraticStatus ?? null
  const curIsOpen = cur ? isOpenQuestion(cur) : false
  useEffect(() => {
    if (!socratesOn || !curId || curPhase !== 'snapshot' || curStatus !== 'none' || curIsOpen) return
    if (socratesTriggered.current.has(curId)) return
    socratesTriggered.current.add(curId)
    void prepareSocrates(curId)
  }, [socratesOn, curId, curPhase, curStatus, curIsOpen, prepareSocrates])

  if (!view) {
    return <p className="text-muted-foreground">{error ? `Could not load the dashboard: ${error}` : 'Connecting…'}</p>
  }

  const features = view.session.features
  const betweenQuestions = !cur || cur.phase === 'resolved'
  const rankingText =
    features.contrarianCredit || features.steelman
      ? 'Calibration first (plus contrarian credit when enabled), then persuasion, then steelman.'
      : 'Calibration first, then persuasion.'

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
            <CurrentQuestion
              view={view}
              cur={cur}
              busy={busy}
              run={run}
              api={api}
              socratesBusy={socratesBusy}
              onPrepareSocrates={prepareSocrates}
              onCandidates={showCandidates}
              candidates={candidates[cur.questionId]}
            />
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

          {view.cascadeComparison && <CascadeComparison comparison={view.cascadeComparison} />}

          <ArcCard view={view} api={api} />

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
              <CardDescription>{rankingText}</CardDescription>
            </CardHeader>
            <CardContent>
              <Leaderboard rows={view.leaderboard} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <QuestionList
            view={view}
            busy={busy}
            run={run}
            api={api}
            onCandidates={showCandidates}
            topicBatch={candidates[TOPIC_KEY]}
          />
          {betweenQuestions && (
            <SessionSettings sessionId={view.session.id} features={features} busy={busy} run={run} api={api} />
          )}
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

/** Surprisingly popular (plan §17.2) hint per phase. Percentages only, never "N of M". */
function spHint(sp: NonNullable<Current['surprisinglyPopular']>, phase: Current['phase']): string | undefined {
  if (phase === 'blind') {
    return sp.predictorPct === null ? undefined : `${sp.predictorPct.toFixed(0)}% of submitters predicted the class`
  }
  const parts: string[] = []
  if (sp.actualTruePct !== null && sp.predictedTruePct !== null) {
    parts.push(`${sp.actualTruePct.toFixed(0)}% leaned TRUE vs ${sp.predictedTruePct.toFixed(0)}% expected`)
  } else {
    parts.push('not enough predictions')
  }
  if (phase === 'resolved' && sp.insightPct !== null) {
    parts.push(`${sp.insightPct.toFixed(0)}% of predictors expected to be outvoted and were right`)
  }
  return parts.join(' · ')
}

function CurrentQuestion({
  view,
  cur,
  busy,
  run,
  api,
  socratesBusy,
  onPrepareSocrates,
  onCandidates,
  candidates,
}: {
  view: TeacherView
  cur: Current
  busy: string | null
  run: Run
  api: Api
  socratesBusy: boolean
  onPrepareSocrates: (questionId: string) => Promise<void>
  onCandidates: (key: string, batch: CandidatesBatch) => void
  candidates: (CandidatesBatch & { version: number }) | undefined
}) {
  const features = view.session.features
  const open = isOpenQuestion(cur)
  const clustersHint = cur.clustersStatus === 'ready' ? `${cur.clusters.length} argument clusters` : cur.clustersStatus
  const groupsHint = features.socrates ? `${clustersHint} · Socrates ${cur.socraticStatus}` : clustersHint
  const liveHint = cur.phase === 'open' ? 'moving' : cur.cascade && cur.phase === 'blind' ? 'visible to students (cascade)' : ''

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            Question {cur.index + 1}: {cur.proposition}
          </CardTitle>
          <span className="flex items-center gap-2">
            {cur.cascade && <Badge variant="outline">consensus visible</Badge>}
            <PhaseBadge phase={cur.phase} />
            <Countdown endsAt={cur.phaseEndsAt} />
          </span>
        </div>
        <CardDescription>
          {open ? (
            <>
              Open question · free-text answers ·{' '}
              {cur.referenceAnswer ? `reference: ${cur.referenceAnswer}` : 'no reference answer'}
            </>
          ) : (
            <>
              {cur.mode === 'stem' ? `Answer: ${cur.correctAnswer ? 'TRUE' : 'FALSE'}` : 'Humanities mode: no resolution'} ·{' '}
              {cur.submissionCount}/{cur.participantCount} submitted
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Controls
          view={view}
          busy={busy}
          run={run}
          api={api}
          socratesBusy={socratesBusy}
          onPrepareSocrates={onPrepareSocrates}
          onCandidates={onCandidates}
        />
        {open ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Answers" value={`${cur.submissionCount}/${cur.participantCount}`} hint="free text, teacher only" />
              <Stat
                label="Answer clusters"
                value={cur.clustersStatus === 'ready' ? String(cur.clusters.length) : '—'}
                hint={
                  cur.clustersStatus === 'ready'
                    ? 'sharpen one into a proposition'
                    : cur.clustersStatus === 'skipped'
                      ? 'too few answers to cluster'
                      : cur.phase === 'blind'
                        ? 'end the answers, then run clustering'
                        : 'run clustering'
                }
              />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">Answer clusters</h3>
              {cur.clusters.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {cur.clustersStatus === 'skipped' ? 'Too few answers to cluster.' : 'No answer clusters yet.'}
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
            {candidates && (
              <CandidatesPanel
                key={`sharpen-${cur.questionId}-${candidates.version}`}
                batch={candidates}
                clusters={cur.clusters}
                sessionId={view.session.id}
                api={api}
                busy={busy}
                run={run}
              />
            )}
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Blind consensus" value={fmtPct(cur.blindPricePct)} hint={cur.blindRevealed ? 'revealed to class' : 'teacher only'} />
              <Stat label="Live consensus" value={fmtPct(cur.pricePct)} hint={liveHint} />
              <Stat label="Groups" value={String(cur.groups.length)} hint={groupsHint} />
              {cur.consideredOpposite && (
                <Stat
                  label="Considered the opposite"
                  value={`${cur.consideredOpposite.pct.toFixed(0)}%`}
                  hint={
                    cur.consideredOpposite.meanShiftPts === null
                      ? undefined
                      : `pulled confidence back ${cur.consideredOpposite.meanShiftPts.toFixed(0)} points on average`
                  }
                />
              )}
              {cur.surprisinglyPopular && (
                <Stat
                  label="Surprisingly popular"
                  value={cur.surprisinglyPopular.answer === null ? '—' : cur.surprisinglyPopular.answer ? 'TRUE' : 'FALSE'}
                  hint={spHint(cur.surprisinglyPopular, cur.phase)}
                />
              )}
              {cur.steelman && (
                <Stat
                  label="Steelman"
                  value={`${cur.steelman.total > 0 ? ((100 * cur.steelman.count) / cur.steelman.total).toFixed(0) : '0'}% wrote one`}
                  hint={cur.steelman.meanFidelity === null ? 'no grades yet' : `mean fidelity ${cur.steelman.meanFidelity.toFixed(0)}`}
                />
              )}
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
                          {g.socratesQuestions && g.socratesQuestions.length > 0 && (
                            <ol className="mt-1 ml-5 list-decimal text-xs text-muted-foreground">
                              {g.socratesQuestions.map((sq, i) => (
                                <li key={i}>{sq}</li>
                              ))}
                            </ol>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {cur.narration && <p className="text-sm italic">{cur.narration}</p>}
              </div>
            </div>
            {cur.phase === 'resolved' && features.argumentElo && <TopArguments current={cur} />}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Controls({
  view,
  busy,
  run,
  api,
  socratesBusy,
  onPrepareSocrates,
  onCandidates,
}: {
  view: TeacherView
  busy: string | null
  run: Run
  api: Api
  socratesBusy: boolean
  onPrepareSocrates: (questionId: string) => Promise<void>
  onCandidates: (key: string, batch: CandidatesBatch) => void
}) {
  const cur = view.current!
  const qid = cur.questionId
  const features = view.session.features
  const btn = (
    label: string,
    fn: () => Promise<unknown>,
    variant: 'default' | 'outline' | 'secondary' = 'default',
    opts: { disabled?: boolean; tick?: boolean } = {},
  ) => (
    <Button key={label} variant={variant} disabled={busy !== null || opts.disabled === true} onClick={() => void run(label, fn, opts)}>
      {busy === label ? '…' : label}
    </Button>
  )
  const clustering = btn('Run clustering', () => api.cluster(qid), 'outline')

  if (isOpenQuestion(cur)) {
    // Open question (plan §17.3): End answers → Run clustering → Sharpen → Add → Finish.
    const sharpen = btn(
      'Sharpen into a proposition',
      async () => {
        const result = await api.sharpen(qid)
        onCandidates(qid, { kind: 'sharpen', sourceQuestionId: qid, result })
      },
      'secondary',
      { disabled: cur.clustersStatus !== 'ready', tick: false },
    )
    switch (cur.phase) {
      case 'blind':
        return <div className="flex flex-wrap gap-2">{btn('End answers', () => api.advance(qid, { from: 'blind' }))}</div>
      case 'snapshot':
        return (
          <div className="flex flex-wrap gap-2">
            {clustering}
            {sharpen}
            {btn('Finish open question', () => api.advance(qid, { from: 'snapshot' }))}
          </div>
        )
      case 'resolved':
        return (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {clustering}
              {sharpen}
            </div>
            <p className="text-sm text-muted-foreground">Finished. Add a sharpened proposition, then start it from the list.</p>
          </div>
        )
      default:
        return null
    }
  }

  const socrates =
    features.socrates && (cur.phase === 'snapshot' || cur.phase === 'structured') ? (
      <Button
        key="socrates"
        variant="outline"
        disabled={socratesBusy || cur.socraticStatus === 'ready'}
        onClick={() => void onPrepareSocrates(qid)}
      >
        {socratesBusy ? 'Preparing Socrates…' : cur.socraticStatus === 'ready' ? 'Socrates ready' : 'Prepare Socrates'}
      </Button>
    ) : null

  switch (cur.phase) {
    case 'blind':
      return <div className="flex flex-wrap gap-2">{btn('End blind phase', () => api.advance(qid, { from: 'blind' }))}</div>
    case 'snapshot':
      return (
        <div className="flex flex-wrap gap-2">
          {!cur.blindRevealed && btn('Reveal blind consensus', () => api.reveal(qid), 'secondary')}
          {clustering}
          {btn('Recompute snapshot', () => api.recomputeSnapshot(qid), 'outline')}
          {socrates}
          {btn('Start debate', () => api.advance(qid, { from: 'snapshot' }))}
        </div>
      )
    case 'structured':
      return (
        <div className="flex flex-wrap gap-2">
          {clustering}
          {socrates}
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

function answerLabel(q: TeacherQuestionRow): string {
  if (q.mode === 'stem') return q.correctAnswer ? 'TRUE' : 'FALSE'
  if (q.mode === 'open') return q.referenceAnswer ? `ref: ${q.referenceAnswer}` : 'free text'
  return 'no answer'
}

/** The same proposition again with the live consensus visible (plan §17.5, the one-click demo trick). */
function cascadeRerun(q: TeacherQuestionRow): QuestionInput {
  return {
    proposition: q.proposition,
    mode: q.mode,
    ...(typeof q.correctAnswer === 'boolean' ? { correctAnswer: q.correctAnswer } : {}),
    cascade: true,
  }
}

function QuestionList({
  view,
  busy,
  run,
  api,
  onCandidates,
  topicBatch,
}: {
  view: TeacherView
  busy: string | null
  run: Run
  api: Api
  onCandidates: (key: string, batch: CandidatesBatch) => void
  topicBatch: (CandidatesBatch & { version: number }) | undefined
}) {
  const [proposition, setProposition] = useState('')
  const [mode, setMode] = useState<Mode>('stem')
  const [answer, setAnswer] = useState<boolean>(false)
  const [referenceAnswer, setReferenceAnswer] = useState('')
  const [cascade, setCascade] = useState(false)
  const [topic, setTopic] = useState('')
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
                  {q.mode} · {answerLabel(q)} · {q.phase}
                  {q.cascade ? ' · consensus visible' : ''}
                  {q.sourceIndex !== null ? ` · from Q${q.sourceIndex + 1}` : ''}
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
              {q.phase === 'resolved' && !q.cascade && !isOpenQuestion(q) && (
                <Button
                  size="xs"
                  variant="outline"
                  className="h-auto shrink-0 whitespace-normal py-1 text-left"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(`rerun-${q.id}`, () => api.addQuestions(view.session.id, { questions: [cascadeRerun(q)] }))
                  }
                >
                  Run again with the consensus visible
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
              const question: QuestionInput =
                mode === 'open'
                  ? {
                      proposition: proposition.trim(),
                      mode: 'open',
                      ...(referenceAnswer.trim() ? { referenceAnswer: referenceAnswer.trim() } : {}),
                    }
                  : {
                      proposition: proposition.trim(),
                      mode,
                      ...(mode === 'stem' ? { correctAnswer: answer } : {}),
                      ...(cascade ? { cascade: true } : {}),
                    }
              await api.addQuestions(view.session.id, { questions: [question] })
              setProposition('')
              setReferenceAnswer('')
              setCascade(false)
            })
          }}
        >
          <Textarea
            className="min-h-16 text-sm"
            placeholder={
              mode === 'open'
                ? 'An open question, e.g. “What causes the seasons?”'
                : 'A contestable proposition, e.g. “The ball costs 10 cents.”'
            }
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
            <label className="flex items-center gap-1">
              <input type="radio" name="mode" checked={mode === 'open'} onChange={() => setMode('open')} /> Open question
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
          {mode === 'open' && (
            <Input
              className="text-sm"
              placeholder="Reference answer (optional), e.g. axial tilt"
              value={referenceAnswer}
              maxLength={300}
              onChange={(e) => setReferenceAnswer(e.target.value)}
            />
          )}
          {mode !== 'open' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
              Show the live consensus during the blind phase (cascade demo)
            </label>
          )}
          <Button type="submit" variant="outline" size="sm" disabled={busy !== null || !proposition.trim()}>
            Add question
          </Button>
        </form>
        <form
          className="flex flex-col gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            const t = topic.trim()
            if (!t) return
            void run(
              'generate',
              async () => {
                const result = await api.generate(view.session.id, t)
                onCandidates(TOPIC_KEY, { kind: 'topic', sourceQuestionId: null, result })
              },
              { tick: false },
            )
          }}
        >
          <div className="flex gap-2">
            <Input
              className="text-sm"
              placeholder="Generate from topic, e.g. Newtonian mechanics"
              value={topic}
              maxLength={120}
              onChange={(e) => setTopic(e.target.value)}
            />
            <Button type="submit" variant="outline" size="sm" className="h-8 shrink-0" disabled={busy !== null || !topic.trim()}>
              {busy === 'generate' ? '…' : 'Generate'}
            </Button>
          </div>
          {topicBatch && (
            <CandidatesPanel
              key={`topic-${topicBatch.version}`}
              batch={topicBatch}
              clusters={[]}
              sessionId={view.session.id}
              api={api}
              busy={busy}
              run={run}
            />
          )}
        </form>
      </CardContent>
    </Card>
  )
}
