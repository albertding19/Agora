'use client'
import { useState } from 'react'
import { BeliefSlider } from '@/components/student/BeliefSlider'
import { Countdown } from '@/components/shared/Countdown'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import type { Api } from '@/lib/api'
import { REASONING_MAX_CHARS, type Band, type StudentView } from '@/lib/types'

/**
 * Blind phase: optional reasoning → AI band (never blocking) → the student's
 * own number. The student owns the final number; the AI only proposes.
 */
export function BlindEntry({
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
  const question = view.question!
  const [reasoning, setReasoning] = useState(view.my?.reasoning ?? '')
  const [pct, setPct] = useState<number>(view.my?.pct ?? 50)
  const [band, setBand] = useState<Band | null>(view.my?.band ?? null)
  const [proposing, setProposing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submittedPct, setSubmittedPct] = useState<number | null>(view.my?.submitted ? (view.my?.pct ?? null) : null)
  const [error, setError] = useState<string | null>(null)

  async function readReasoning() {
    if (!reasoning.trim()) return
    setProposing(true)
    setError(null)
    try {
      const result = await api.propose(question.id, { participantId, reasoning: reasoning.trim() })
      setBand(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setProposing(false)
    }
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await api.submit(question.id, { participantId, pct, reasoning: reasoning.trim() || undefined })
      setSubmittedPct(pct)
      onMutated()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const bandRange = band && band.stance !== 'UNCLEAR' ? { lo: band.lo, hi: band.hi } : band ? { lo: band.lo, hi: band.hi } : null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>
            Question {question.index + 1} of {question.count}
          </CardTitle>
          <Countdown endsAt={view.phaseEndsAt} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-lg leading-snug font-medium">{question.proposition}</p>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-muted-foreground" htmlFor="reasoning">
            Why do you think so? (optional, 1–2 sentences)
          </label>
          <Textarea
            id="reasoning"
            className="min-h-20"
            maxLength={REASONING_MAX_CHARS}
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            placeholder="Because…"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground tabular-nums">
              {reasoning.length}/{REASONING_MAX_CHARS}
            </span>
            <Button variant="outline" size="sm" disabled={!reasoning.trim() || proposing} onClick={readReasoning}>
              {proposing ? 'Reading…' : 'Read my reasoning'}
            </Button>
          </div>
        </div>

        {band && (
          <div className="rounded-lg bg-muted p-3 text-sm">
            <p>{band.reading}</p>
            <p className="mt-1 text-muted-foreground">
              Reads as {band.stance === 'UNCLEAR' ? 'unclear' : band.stance}. Proposed range {band.lo}–{band.hi}%. Tap a value or
              drag anywhere; the number is yours.
            </p>
            <div className="mt-2 flex gap-2">
              {[band.lo, Math.round((band.lo + band.hi) / 10) * 5, band.hi]
                .filter((v, i, arr) => arr.indexOf(v) === i)
                .map((v) => (
                  <Button key={v} size="sm" variant="secondary" onClick={() => setPct(v)}>
                    {v}%
                  </Button>
                ))}
            </div>
          </div>
        )}

        <BeliefSlider value={pct} onChange={setPct} band={bandRange} />

        <Button size="lg" disabled={submitting} onClick={submit}>
          {submitting ? 'Sending…' : submittedPct === null ? 'Submit my number' : 'Update my number'}
        </Button>
        {submittedPct !== null && (
          <p className="text-center text-sm text-muted-foreground">Your number: {submittedPct}%. You can change it until the timer ends.</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
