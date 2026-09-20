'use client'
import { useState } from 'react'
import { Countdown } from '@/components/shared/Countdown'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import type { Api } from '@/lib/api'
import { REASONING_MAX_CHARS, type StudentView } from '@/lib/types'

/**
 * Open question (plan §17.3), blind phase: a free-text answer and nothing
 * else. No proposer, no slider, no price; the answers are clustered and
 * sharpened into the next proposition on the teacher's side.
 */
export function OpenAnswer({
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
  const [text, setText] = useState(view.my?.reasoning ?? '')
  const [submitted, setSubmitted] = useState<boolean>((view.my?.reasoning ?? '').trim().length > 0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const trimmed = text.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError(null)
    try {
      await api.answer(question.id, { participantId, text: trimmed })
      setSubmitted(true)
      onMutated()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

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
          <label className="text-sm text-muted-foreground" htmlFor="open-answer">
            Your answer (1–2 sentences)
          </label>
          <Textarea
            id="open-answer"
            className="min-h-24"
            maxLength={REASONING_MAX_CHARS}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="I think…"
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {text.length}/{REASONING_MAX_CHARS}
          </span>
        </div>

        <Button size="lg" disabled={submitting || !text.trim()} onClick={submit}>
          {submitting ? 'Sending…' : submitted ? 'Update my answer' : 'Submit my answer'}
        </Button>
        {submitted && (
          <p className="text-center text-sm text-muted-foreground">Your answer is in. You can change it until the timer ends.</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
