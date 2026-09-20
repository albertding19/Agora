'use client'
import { formatSeconds, useCountdown } from '@/lib/realtime/clock'

export function Countdown({ endsAt, className }: { endsAt: string | null | undefined; className?: string }) {
  const seconds = useCountdown(endsAt)
  if (!endsAt) return null
  return (
    <span className={className ?? 'font-mono text-lg tabular-nums'} aria-live="polite">
      {formatSeconds(seconds)}
    </span>
  )
}
