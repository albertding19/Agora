'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import type { Api } from '@/lib/api'
import { STEELMAN_MAX_CHARS, type SteelmanSide, type StudentView } from '@/lib/types'

/**
 * Steelman gate (plan §17.7): before and during the structured round the
 * student writes the other side's best argument in one sentence; an agent
 * grades fidelity 0-100. The side comes from the server (`my.steelmanSide`),
 * derived from the student's own blind number and never stored. Mounted by
 * the page only when `features.steelman && my.steelmanSide`, keyed by
 * question id so state resets per question; a refresh restores the last
 * grade from `my.steelman`.
 *
 * A fallback grade is `score: null` ("—"), never a number: it must neither
 * reward nor punish, and the cache never serves fallbacks, so "Try grading
 * again" re-posts the same text.
 */
interface Graded {
  text: string
  score: number | null
  note: string | null
  fallback: boolean
}

function sideLine(side: SteelmanSide, submitted: boolean): string {
  switch (side) {
    case 'FALSE':
      return 'Make the best case that the proposition is FALSE.'
    case 'TRUE':
      return 'Make the best case that the proposition is TRUE.'
    case 'EITHER':
      // EITHER is a number at exactly 50 or no number at all.
      return submitted
        ? 'You sat at 50. Make the best case for one side, your pick.'
        : "You didn't set a number. Make the best case for one side, your pick."
  }
}

export function Steelman({ view, api, participantId }: { view: StudentView; api: Api; participantId: string }) {
  const question = view.question
  const side = view.my?.steelmanSide ?? null
  const submitted = view.my?.submitted ?? false
  const initial = view.my?.steelman ?? null
  const [text, setText] = useState(initial?.text ?? '')
  const [graded, setGraded] = useState<Graded | null>(
    initial ? { text: initial.text, score: initial.score, note: initial.note, fallback: initial.score === null } : null,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!question || side === null) return null
  const questionId = question.id

  async function grade(body: string) {
    const trimmed = body.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.steelman(questionId, { participantId, text: trimmed })
      setGraded({ text: trimmed, score: result.score, note: result.note, fallback: result.fallback })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const unchanged = graded !== null && graded.text === text.trim()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Steelman the other side</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">{sideLine(side, submitted)}</p>

        <div className="flex flex-col gap-2">
          <Textarea
            id="steelman"
            aria-label="Your steelman"
            className="min-h-20"
            maxLength={STEELMAN_MAX_CHARS}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="The strongest argument for that side is…"
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {text.length}/{STEELMAN_MAX_CHARS}
          </span>
        </div>

        {graded && (
          <div className="rounded-lg bg-muted p-3 text-center">
            <div className="text-xs text-muted-foreground">Fidelity</div>
            <div className="text-4xl font-semibold tabular-nums">{graded.score === null ? '—' : graded.score.toFixed(0)}</div>
            {graded.note && <p className="mt-1 text-sm">{graded.note}</p>}
            {graded.fallback && (
              <Button
                className="mt-2"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void grade(graded.text)}
              >
                {busy ? 'Grading…' : 'Try grading again'}
              </Button>
            )}
          </div>
        )}

        <Button size="lg" disabled={busy || !text.trim() || unchanged} onClick={() => void grade(text)}>
          {busy ? 'Grading…' : graded && !unchanged ? 'Update my steelman' : 'Submit my steelman'}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
