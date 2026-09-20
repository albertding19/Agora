'use client'

/**
 * Replay (plan §17.8): a 20-second time-lapse of one question's consensus
 * with the arguments that moved it as captions. Dashboard only — the
 * projector polls a view with no replay state, and a synchronized
 * "replay is playing" flag would be server state for one demo beat.
 *
 * ANONYMITY RULE. A note is never accompanied by a name, a participant id,
 * the mover's own number, or the size of their move. Anchor points (the
 * snapshot, the open-phase anchor, the resolved point) carry no note.
 * Reasoning is shown verbatim because this is a teacher-only surface; it
 * still never says who wrote it. The `QuestionHistory` this component
 * receives carries none of those fields, so nothing here can leak one.
 *
 * Animation: a requestAnimationFrame loop that starts only on Play and is
 * cancelled on cleanup. Each frame adds at most 100 ms of progress, so a
 * backgrounded tab resumes where it paused instead of jumping to the end.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { phaseLabel } from '@/components/shared/PhaseBadge'
import { SocraticArc } from '@/components/teacher/SocraticArc'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { REPLAY_MS, replayRevealCount, replaySummary } from '@/lib/scoring/replay'
import type { QuestionHistory } from '@/lib/types'

/** Longest slice of wall time one frame may add to the replay. */
const MAX_FRAME_MS = 100
const COPIED_FLASH_MS = 1500

export function Replay({ history }: { history: QuestionHistory }) {
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [copied, setCopied] = useState(false)
  const progressRef = useRef(0)
  const downloadRef = useRef<HTMLAnchorElement>(null)

  // The animation loop: alive only while playing.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last: number | null = null
    const step = (now: number): void => {
      if (last !== null) {
        const dt = Math.min(MAX_FRAME_MS, Math.max(0, now - last))
        const next = Math.min(1, progressRef.current + dt / REPLAY_MS)
        progressRef.current = next
        setProgress(next)
        if (next >= 1) {
          setPlaying(false)
          return
        }
      }
      last = now
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // The download target: one object URL per history, written straight onto
  // the anchor (React never manages its href) and revoked when the history
  // changes or on unmount.
  useEffect(() => {
    const link = downloadRef.current
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    link?.setAttribute('href', url)
    return () => {
      link?.removeAttribute('href')
      URL.revokeObjectURL(url)
    }
  }, [history])

  const revealUpTo = replayRevealCount(history.points, progress)
  const finished = progress >= 1

  // The chart re-renders only when another point is revealed, not on every frame.
  const chart = useMemo(
    () => (
      <SocraticArc
        points={history.points}
        phaseLog={history.phaseLog}
        outcome={history.outcome}
        blindPricePct={history.blindPricePct}
        postPricePct={history.postPricePct}
        mode={history.mode}
        revealUpTo={revealUpTo}
      />
    ),
    [history, revealUpTo],
  )

  const shown = history.points.slice(0, revealUpTo)
  const lastPoint = shown.length > 0 ? shown[shown.length - 1] : null
  let note: string | null = null
  for (let i = shown.length - 1; i >= 0; i--) {
    const n = shown[i].note?.trim()
    if (n) {
      note = n
      break
    }
  }

  const restart = (): void => {
    progressRef.current = 0
    setProgress(0)
    setPlaying(true)
  }

  const copySummary = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(replaySummary(history))
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_FLASH_MS)
    } catch {
      // Clipboard unavailable (insecure context or denied): nothing to do.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {chart}

      <div className="flex h-20 flex-col justify-center gap-1 overflow-hidden rounded-lg bg-muted px-3 py-2">
        {note ? (
          <p className="line-clamp-2 text-sm">“{note}”</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {lastPoint ? 'No argument on record for this point.' : 'Press Play to start the replay.'}
          </p>
        )}
        {lastPoint && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {phaseLabel(lastPoint.phase)} · {Math.round(lastPoint.pct)}%
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setPlaying((p) => !p)} disabled={finished}>
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Button size="sm" variant="outline" onClick={restart}>
          Restart
        </Button>
        <Progress value={Math.round(progress * 100)} className="min-w-32 flex-1" aria-label="Replay progress" />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a
          ref={downloadRef}
          download={`agora-replay-q${history.index + 1}.json`}
          className="text-primary underline underline-offset-4"
        >
          Download replay data (JSON)
        </a>
        <Button size="sm" variant="ghost" onClick={copySummary}>
          {copied ? 'Copied' : 'Copy summary'}
        </Button>
      </div>

      {finished && <p className="text-sm text-muted-foreground">Replay finished. Press Restart to run it again.</p>}
    </div>
  )
}
