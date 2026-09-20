'use client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { Api } from '@/lib/api'
import { FEATURE_KEYS, type FeatureKey, type Features } from '@/lib/types'

/** Teacher-facing labels for the per-session feature flags (plan §17). */
const LABELS: Record<FeatureKey, string> = {
  considerOpposite: 'Consider the opposite',
  predictClass: 'Predict the class',
  steelman: 'Steelman gate',
  socrates: 'Socrates in groups',
  contrarianCredit: 'Contrarian credit',
  argumentElo: 'Argument comparisons',
}

const HINTS: Record<FeatureKey, string> = {
  considerOpposite: 'A second number after the first, assuming the first is wrong. The blind number is the average.',
  predictClass: 'Students also predict what percent of the class will say TRUE.',
  steelman: 'Before the debate each student writes the other side’s best argument; an agent grades fidelity.',
  socrates: 'One Socratic question per speaker in every group, prepared at the snapshot.',
  contrarianCredit: 'Extra credit for a right lean when the class leaned wrong; added to calibration for ranking.',
  argumentElo: 'After resolution students compare pairs of anonymous arguments; the strongest surfaces.',
}

export type RunAction = (label: string, fn: () => Promise<unknown>) => Promise<void>

/**
 * "Session settings": one checkbox per feature flag. Views read the flags
 * live, so a flag toggled here applies from the next question (or the next
 * poll). Shown in the lobby and between questions only.
 */
export function SessionSettings({
  sessionId,
  features,
  busy,
  run,
  api,
}: {
  sessionId: string
  features: Features
  busy: string | null
  run: RunAction
  api: Api
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Session settings</CardTitle>
        <CardDescription>Extensions to the base session. Everything is off by default.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {FEATURE_KEYS.map((key) => (
            <li key={key}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={features[key]}
                  disabled={busy !== null}
                  onChange={(e) => {
                    const checked = e.target.checked
                    void run(`feature-${key}`, () => api.setFeatures(sessionId, { [key]: checked }))
                  }}
                />
                <span>
                  <span className="font-medium">{LABELS[key]}</span>
                  <span className="block text-xs text-muted-foreground">{HINTS[key]}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
