'use client'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Api } from '@/lib/api'
import type { CandidatesResult } from '@/lib/types'

/** One batch of generated propositions and where it came from. */
export interface CandidatesBatch {
  /** `sharpen`: from an open question's answer clusters; `topic`: from a typed topic. */
  kind: 'sharpen' | 'topic'
  /** The open question the candidates were sharpened from; null for a topic. */
  sourceQuestionId: string | null
  result: CandidatesResult
}

export type RunAction = (label: string, fn: () => Promise<unknown>) => Promise<void>

interface Draft {
  text: string
  correctAnswer: boolean
  misconception: string
  sourceClusterIndex: number | null
  added: boolean
}

/**
 * Editable candidate propositions (plan §17.3). Every candidate is a draft the
 * teacher can rewrite and re-answer before "Add as next question"; a fallback
 * batch never inserts anything on its own. Mount with a `key` that changes per
 * batch so the drafts reset.
 */
export function CandidatesPanel({
  batch,
  clusters,
  sessionId,
  api,
  busy,
  run,
}: {
  batch: CandidatesBatch
  /** The source question's clusters, to name "from cluster: …"; empty for a topic batch. */
  clusters: readonly { index: number; label: string; count: number }[]
  sessionId: string
  api: Api
  busy: string | null
  run: RunAction
}) {
  const uid = useId()
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    batch.result.candidates.map((c) => ({
      text: c.text,
      correctAnswer: c.correctAnswer,
      misconception: c.misconception,
      sourceClusterIndex: c.sourceClusterIndex,
      added: false,
    })),
  )

  const patch = (i: number, p: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...p } : d)))

  const clusterLabel = (idx: number): string => {
    const c = clusters.find((cl) => cl.index === idx)
    return c ? `${c.label} (${c.count})` : `#${idx + 1}`
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">
        {batch.kind === 'sharpen' ? 'Candidate propositions from the answers' : 'Candidate propositions from the topic'}
      </h3>
      {batch.result.fallback && (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          {batch.kind === 'topic'
            ? 'Fallback list, not topic-specific. Edit the text and set the answer before adding.'
            : 'Fallback suggestions. Edit the text and set the answer before adding.'}
        </p>
      )}
      {drafts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {batch.kind === 'sharpen' ? 'No candidate survived. Run clustering with more answers, or write one.' : 'No candidates. Try another topic.'}
        </p>
      )}
      <ol className="flex flex-col gap-3">
        {drafts.map((d, i) => {
          const name = `${uid}-cand-${i}`
          const label = `add-candidate-${uid}-${i}`
          return (
            <li key={i} className="flex flex-col gap-2 rounded-md border border-border p-2">
              <Textarea
                className="min-h-16 text-sm"
                value={d.text}
                maxLength={300}
                disabled={d.added}
                onChange={(e) => patch(i, { text: e.target.value })}
              />
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted-foreground">Answer:</span>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={name}
                    checked={d.correctAnswer}
                    disabled={d.added}
                    onChange={() => patch(i, { correctAnswer: true })}
                  />{' '}
                  TRUE
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={name}
                    checked={!d.correctAnswer}
                    disabled={d.added}
                    onChange={() => patch(i, { correctAnswer: false })}
                  />{' '}
                  FALSE
                </label>
              </div>
              {d.misconception && <p className="text-xs text-muted-foreground">Misconception: {d.misconception}</p>}
              {d.sourceClusterIndex !== null && (
                <p className="text-xs text-muted-foreground">from cluster: {clusterLabel(d.sourceClusterIndex)}</p>
              )}
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || d.added || !d.text.trim()}
                  onClick={() =>
                    void run(label, async () => {
                      await api.addQuestions(sessionId, {
                        questions: [
                          {
                            proposition: d.text.trim(),
                            mode: 'stem',
                            correctAnswer: d.correctAnswer,
                            ...(batch.sourceQuestionId ? { sourceQuestionId: batch.sourceQuestionId } : {}),
                          },
                        ],
                      })
                      patch(i, { added: true })
                    })
                  }
                >
                  {d.added ? 'Added' : busy === label ? '…' : 'Add as next question'}
                </Button>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
