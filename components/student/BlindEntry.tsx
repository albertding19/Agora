'use client'
import { useState } from 'react'
import { BeliefSlider } from '@/components/student/BeliefSlider'
import { Countdown } from '@/components/shared/Countdown'
import { PriceDisplay } from '@/components/shared/PriceDisplay'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import type { Api } from '@/lib/api'
import { blendPct } from '@/lib/scoring/blend'
import { REASONING_MAX_CHARS, type Band, type BlindStep, type StudentView } from '@/lib/types'

/**
 * Blind phase: optional reasoning → AI band (never blocking) → the student's
 * own number. The student owns the final number; the AI only proposes.
 *
 * With `features.considerOpposite` on (plan §17.1) this is a three-step
 * machine: `first` (today's screen) → `opposite` ("assume you're wrong") →
 * `done` (both numbers and their average). The step is seeded from
 * `view.my.blindStep`, which the server decides from the submission, so a
 * refresh restores it; the component is keyed by question id at the call site.
 * With the flag off only the `first` screen ever renders and behaves as before.
 *
 * `features.predictClass` (plan §17.2) adds one compact slider to the first
 * step. A cascade question (plan §17.5) is the only case where `view.pricePct`
 * is non-null during blind; it is shown above the slider.
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
  const my = view.my
  const considerOpposite = view.features.considerOpposite
  const predictClass = view.features.predictClass

  const [step, setStep] = useState<BlindStep>(considerOpposite ? (my?.blindStep ?? 'first') : 'first')
  const [reasoning, setReasoning] = useState(my?.reasoning ?? '')
  const [pct, setPct] = useState<number>(my?.firstPct ?? my?.pct ?? 50)
  const [band, setBand] = useState<Band | null>(my?.band ?? null)
  const [predicted, setPredicted] = useState<number>(my?.predictedTruePct ?? 50)
  const [proposing, setProposing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  /** The first number on record (the only number when the flag is off). */
  const [firstPct, setFirstPct] = useState<number | null>(my?.submitted ? (my.firstPct ?? my.pct ?? null) : null)
  const [error, setError] = useState<string | null>(null)

  // Consider the opposite: the second number and its optional reasoning.
  const [oppositePct, setOppositePct] = useState<number>(my?.oppositePct ?? 50)
  const [oppositeText, setOppositeText] = useState(my?.oppositeReasoning ?? '')
  /** The second number on record. */
  const [savedOpposite, setSavedOpposite] = useState<number | null>(my?.oppositePct ?? null)

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
      await api.submit(question.id, {
        participantId,
        pct,
        reasoning: reasoning.trim() || undefined,
        ...(predictClass ? { predictedTruePct: predicted } : {}),
      })
      setFirstPct(pct)
      onMutated()
      if (considerOpposite) setStep('opposite')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function submitOpposite() {
    setSubmitting(true)
    setError(null)
    try {
      await api.oppose(question.id, { participantId, pct: oppositePct, reasoning: oppositeText.trim() || undefined })
      setSavedOpposite(oppositePct)
      onMutated()
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  // A later step needs the earlier numbers on record; otherwise fall back to the first screen.
  const effectiveStep: BlindStep =
    !considerOpposite || firstPct === null ? 'first' : step === 'done' && savedOpposite === null ? 'opposite' : step

  if (effectiveStep === 'opposite') {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Consider the opposite</CardTitle>
            <Countdown endsAt={view.phaseEndsAt} />
          </div>
          <CardDescription>Socratic self-examination</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p className="text-muted-foreground">{question.proposition}</p>
          <p className="text-sm">Your first number: {firstPct}%.</p>
          <p className="text-lg leading-snug font-medium">
            Now assume that number is wrong. What is the strongest case for the other side?
          </p>

          <div className="flex flex-col gap-2">
            <Textarea
              id="opposite-reasoning"
              className="min-h-20"
              maxLength={REASONING_MAX_CHARS}
              value={oppositeText}
              onChange={(e) => setOppositeText(e.target.value)}
              placeholder="If I'm wrong, it's because…"
              aria-label="The strongest case for the other side (optional)"
            />
            <span className="text-xs text-muted-foreground tabular-nums">
              {oppositeText.length}/{REASONING_MAX_CHARS}
            </span>
          </div>

          <BeliefSlider value={oppositePct} onChange={setOppositePct} />
          <p className="text-center text-sm text-muted-foreground">
            Your number for this question will be the average of the two.
          </p>

          <Button size="lg" disabled={submitting} onClick={submitOpposite}>
            {submitting ? 'Sending…' : 'Submit my second number'}
          </Button>
          <Button variant="link" size="sm" disabled={submitting} onClick={() => setStep('first')}>
            Change my first number
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    )
  }

  if (effectiveStep === 'done') {
    const first = firstPct as number
    const second = savedOpposite as number
    const blended = blendPct(first, second)
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
          <div className="rounded-lg bg-muted p-4 text-center">
            <p className="text-sm text-muted-foreground">
              First number {first}% · second number {second}% → your number:
            </p>
            <div className="text-5xl font-semibold tabular-nums">{blended}%</div>
            <p className="text-sm text-muted-foreground">confident it is TRUE</p>
          </div>
          <p className="text-center text-sm text-muted-foreground">You can change either number until the timer ends.</p>
          <div className="flex flex-col gap-2">
            <Button variant="outline" disabled={submitting} onClick={() => setStep('first')}>
              Change my first number
            </Button>
            <Button variant="outline" disabled={submitting} onClick={() => setStep('opposite')}>
              Change my second number
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    )
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

        {view.pricePct !== null && (
          <div className="flex flex-col gap-2">
            <PriceDisplay pct={view.pricePct} label="Class consensus so far: TRUE" />
            <p className="text-center text-sm text-muted-foreground">
              Others have already answered. This is where the class stands right now. Your number is still yours.
            </p>
          </div>
        )}

        <BeliefSlider value={pct} onChange={setPct} band={bandRange} />

        {predictClass && (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-sm font-medium">Predict the class</p>
            <p className="text-sm text-muted-foreground">What % of the class will say TRUE?</p>
            <BeliefSlider compact value={predicted} onChange={setPredicted} label="of the class will say TRUE" />
          </div>
        )}

        <Button size="lg" disabled={submitting} onClick={submit}>
          {submitting ? 'Sending…' : firstPct === null ? 'Submit my number' : 'Update my number'}
        </Button>
        {!considerOpposite && firstPct !== null && (
          <p className="text-center text-sm text-muted-foreground">Your number: {firstPct}%. You can change it until the timer ends.</p>
        )}
        {considerOpposite && firstPct !== null && (
          <Button variant="link" size="sm" disabled={submitting} onClick={() => setStep(savedOpposite === null ? 'opposite' : 'done')}>
            Keep {firstPct}% and go back
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
