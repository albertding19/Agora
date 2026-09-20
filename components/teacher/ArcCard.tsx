'use client'

/**
 * The "Socratic arc" card (plan §17.6, §17.8). Dashboard only.
 *
 * Offers the running question (from the open phase on) plus every resolved
 * question. The live selection draws straight from the polled teacher view;
 * a past question fetches `GET /api/questions/:id/history` once and keeps it
 * (a resolved history never changes). For a resolved question a "Replay"
 * toggle swaps the static arc for the 20-second time-lapse.
 *
 * Open-mode questions have no consensus and are never offered.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Replay } from '@/components/teacher/Replay'
import { ARC_EMPTY_TEXT, SocraticArc } from '@/components/teacher/SocraticArc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { Api } from '@/lib/api'
import { isOpenQuestion } from '@/lib/phases/machine'
import { PHASES, type QuestionHistory, type TeacherView } from '@/lib/types'

interface ArcOption {
  id: string
  label: string
  live: boolean
  resolved: boolean
}

function arcOptions(view: TeacherView): ArcOption[] {
  const out: ArcOption[] = []
  const cur = view.current
  const liveEligible =
    cur !== null && !isOpenQuestion(cur) && PHASES.indexOf(cur.phase) >= PHASES.indexOf('open')
  if (cur && liveEligible) {
    out.push({
      id: cur.questionId,
      label: `Question ${cur.index + 1} (live)`,
      live: true,
      resolved: cur.phase === 'resolved',
    })
  }
  const past = view.questions
    .filter((q) => q.phase === 'resolved' && !isOpenQuestion(q) && q.id !== cur?.questionId)
    .sort((a, b) => a.index - b.index)
  for (const q of past) out.push({ id: q.id, label: `Question ${q.index + 1}`, live: false, resolved: true })
  return out
}

export function ArcCard({ view, api }: { view: TeacherView; api: Api }) {
  const [picked, setPicked] = useState<string | null>(null)
  const [replay, setReplay] = useState(false)
  const [histories, setHistories] = useState<Record<string, QuestionHistory>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const inflight = useRef(new Set<string>())

  const options = arcOptions(view)
  // Follow the live question unless the teacher picked a past one.
  const selected =
    options.find((o) => o.id === picked) ?? options.find((o) => o.live) ?? options[options.length - 1] ?? null
  const selectedId = selected?.id ?? null
  const needHistory = selected !== null && (!selected.live || replay)
  const history = selectedId ? histories[selectedId] : undefined
  const error = selectedId ? errors[selectedId] : undefined

  useEffect(() => {
    if (!needHistory || selectedId === null) return
    if (histories[selectedId] || inflight.current.has(selectedId)) return
    const id = selectedId
    inflight.current.add(id)
    api
      .history(id)
      .then((h) => setHistories((prev) => ({ ...prev, [id]: h })))
      .catch((e: unknown) => setErrors((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : String(e) })))
      .finally(() => inflight.current.delete(id))
  }, [api, needHistory, selectedId, histories])

  const cur = view.current
  const liveRow = cur ? view.questions.find((q) => q.id === cur.questionId) : undefined

  let body: ReactNode
  if (!selected) {
    body = <p className="text-sm text-muted-foreground">{ARC_EMPTY_TEXT}</p>
  } else if (selected.live && !replay && cur) {
    body = (
      <SocraticArc
        points={cur.priceHistory}
        phaseLog={cur.phaseLog}
        outcome={cur.mode === 'stem' ? cur.correctAnswer : null}
        blindPricePct={cur.blindPricePct}
        postPricePct={liveRow?.postPricePct ?? null}
        mode={cur.mode}
      />
    )
  } else if (history) {
    body = replay ? (
      <Replay key={history.questionId} history={history} />
    ) : (
      <SocraticArc
        points={history.points}
        phaseLog={history.phaseLog}
        outcome={history.outcome}
        blindPricePct={history.blindPricePct}
        postPricePct={history.postPricePct}
        mode={history.mode}
      />
    )
  } else if (error) {
    body = <p className="text-sm text-destructive">Could not load this question&apos;s history: {error}</p>
  } else {
    body = <p className="text-sm text-muted-foreground">Loading…</p>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Socratic arc</CardTitle>
        <CardDescription>The class consensus over time: confident, aporia, resolved.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {options.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Question"
              className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
              value={selected?.id ?? ''}
              onChange={(e) => {
                const id = e.target.value
                const opt = options.find((o) => o.id === id)
                setPicked(opt?.live ? null : id)
                setReplay(false)
                setErrors((prev) => {
                  if (!(id in prev)) return prev
                  const next = { ...prev }
                  delete next[id]
                  return next
                })
              }}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {selected?.resolved && (
              <Button size="sm" variant={replay ? 'secondary' : 'outline'} onClick={() => setReplay((r) => !r)}>
                {replay ? 'Show the arc' : 'Replay'}
              </Button>
            )}
          </div>
        )}
        {body}
      </CardContent>
    </Card>
  )
}
