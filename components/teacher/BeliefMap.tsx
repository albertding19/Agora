import { fmtPct } from '@/components/shared/PriceDisplay'
import type { TeacherQuestionRow } from '@/lib/types'

/** One row per question: blind price, post-debate price, outcome, movement, reading. */
export function BeliefMap({ rows }: { rows: TeacherQuestionRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No questions yet.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1 pr-2">#</th>
            <th className="py-1 pr-2">Proposition</th>
            <th className="py-1 pr-2">Blind</th>
            <th className="py-1 pr-2">After</th>
            <th className="py-1 pr-2">Answer</th>
            <th className="py-1 pr-2">Movement</th>
            <th className="py-1">Reading</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="py-1 pr-2 tabular-nums">{r.index + 1}</td>
              <td className="py-1 pr-2 max-w-md">{r.proposition}</td>
              <td className="py-1 pr-2 tabular-nums">{fmtPct(r.blindPricePct)}</td>
              <td className="py-1 pr-2 tabular-nums">{fmtPct(r.postPricePct)}</td>
              <td className="py-1 pr-2">
                {r.mode === 'open'
                  ? 'free text'
                  : r.mode === 'humanities'
                    ? 'no answer'
                    : r.correctAnswer === null
                      ? '—'
                      : r.correctAnswer
                        ? 'TRUE'
                        : 'FALSE'}
              </td>
              <td className="py-1 pr-2 tabular-nums">
                {r.movementPct === null ? '—' : `${r.movementPct > 0 ? '+' : ''}${r.movementPct.toFixed(0)}`}
              </td>
              <td className="py-1">{r.reading ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
