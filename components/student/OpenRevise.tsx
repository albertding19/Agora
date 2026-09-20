'use client'
import { useState } from 'react'
import { BeliefSlider } from '@/components/student/BeliefSlider'
import { Countdown } from '@/components/shared/Countdown'
import { PriceDisplay } from '@/components/shared/PriceDisplay'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Api } from '@/lib/api'
import type { StudentView } from '@/lib/types'

/** Open discussion: the live consensus moves as students revise their numbers. */
export function OpenRevise({
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
  const [pct, setPct] = useState<number>(view.my?.pct ?? 50)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function commit(value: number) {
    setSaving(true)
    setError(null)
    try {
      await api.revise(question.id, { participantId, pct: value })
      onMutated()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Open discussion</CardTitle>
          <Countdown endsAt={view.phaseEndsAt} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-muted-foreground">{question.proposition}</p>
        <PriceDisplay pct={view.pricePct} label="Class consensus right now: TRUE" />
        <BeliefSlider value={pct} onChange={setPct} onCommit={(v) => void commit(v)} />
        <p className="text-center text-xs text-muted-foreground">
          {saving ? 'Saving…' : 'Drag to revise. Your number updates the class consensus live.'}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
