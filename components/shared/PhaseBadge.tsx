import { Badge } from '@/components/ui/badge'
import type { Phase } from '@/lib/types'

const LABELS: Record<Phase, string> = {
  pending: 'Not started',
  blind: 'Blind phase',
  snapshot: 'Snapshot',
  structured: 'Structured round',
  open: 'Open discussion',
  resolved: 'Resolved',
}

export function phaseLabel(phase: Phase | null | undefined): string {
  return phase ? LABELS[phase] : '—'
}

export function PhaseBadge({ phase }: { phase: Phase | null | undefined }) {
  return <Badge variant={phase === 'open' ? 'default' : 'secondary'}>{phaseLabel(phase)}</Badge>
}
