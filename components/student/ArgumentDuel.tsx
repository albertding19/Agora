'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Api } from '@/lib/api'
import type { ArgumentPair, StudentView } from '@/lib/types'

/**
 * Argument Elo (plan §17.9b): after resolution the student sees pairs of
 * anonymous arguments and taps the more convincing one. Only the two texts
 * ever reach this screen: never an author's name, number, or side, and never
 * a tally. Pairs come from the server (deterministic per student, so the 2 s
 * poll never reshuffles a pair under a thumb); a local done set advances
 * optimistically so the next pair appears before the round trip returns, and
 * the buttons stay enabled while a vote is in flight (the done set already
 * keeps a pair from being tapped twice). Pairs arrive a few at a time, so
 * between the last tap on one batch and the poll that brings the next the
 * local tally runs ahead of the server's; that gap reads "Loading the next
 * pair…", and "every pair" is only said once a poll comes back with none.
 */
function pairKey(p: ArgumentPair): string {
  return [p.a.id, p.b.id].sort().join(':')
}

export function ArgumentDuel({
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
  const question = view.question
  const pairs = view.result?.argumentPairs ?? []
  const votesCast = view.result?.argumentVotesCast ?? 0
  const [done, setDone] = useState<Set<string>>(() => new Set())
  /** The server's tally of this student's comparisons when the duel mounted. */
  const [baseline] = useState(votesCast)
  /** Taps the server did not count (pair already compared); they never reach `votesCast`. */
  const [uncounted, setUncounted] = useState(0)
  const [error, setError] = useState<string | null>(null)

  if (!question) return null
  const questionId = question.id

  const current = pairs.find((p) => !done.has(pairKey(p))) ?? null
  const awaitingNextPairs = baseline + done.size - uncounted > votesCast

  async function choose(pair: ArgumentPair, chosen: ArgumentPair['a']) {
    const key = pairKey(pair)
    if (done.has(key)) return
    const other = chosen.id === pair.a.id ? pair.b : pair.a
    setError(null)
    setDone((prev) => new Set(prev).add(key))
    try {
      const result = await api.argumentVote(questionId, {
        participantId,
        winnerSubmissionId: chosen.id,
        loserSubmissionId: other.id,
      })
      if (!result.counted) setUncounted((n) => n + 1)
      onMutated()
    } catch (e) {
      // Roll the optimistic advance back so the pair can be tapped again.
      setDone((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium">Which is more convincing?</h3>
        <p className="text-xs text-muted-foreground">
          Two reasons written by classmates, unnamed. Tap the one that would move your number.
        </p>
      </div>
      {current ? (
        <div className="flex flex-col gap-2">
          {[current.a, current.b].map((arg) => (
            <Button
              key={arg.id}
              variant="outline"
              className="h-auto w-full justify-start px-3 py-3 text-left text-sm leading-snug whitespace-normal"
              onClick={() => void choose(current, arg)}
            >
              {arg.text}
            </Button>
          ))}
        </div>
      ) : awaitingNextPairs ? (
        <p className="text-sm text-muted-foreground">Loading the next pair…</p>
      ) : (
        <p className="text-sm text-muted-foreground">Thanks. That is every pair we have for you.</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
