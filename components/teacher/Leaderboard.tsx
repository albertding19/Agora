import type { LeaderboardRow } from '@/lib/types'

function fmtScore(v: number | null): string {
  return v === null ? '—' : v.toFixed(0)
}

/** Ranked by calibration, then persuasion. Never by anything else. */
export function Leaderboard({ rows, limit }: { rows: LeaderboardRow[]; limit?: number }) {
  const shown = limit ? rows.slice(0, limit) : rows
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">No scores yet.</p>
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="py-1 pr-2">#</th>
          <th className="py-1 pr-2">Student</th>
          <th className="py-1 pr-2">Calibration</th>
          <th className="py-1">Persuasion</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((r, i) => (
          <tr key={`${r.name}-${i}`} className="border-t border-border">
            <td className="py-1 pr-2 tabular-nums">{i + 1}</td>
            <td className="py-1 pr-2">{r.name}</td>
            <td className="py-1 pr-2 tabular-nums">{fmtScore(r.calibration)}</td>
            <td className="py-1 tabular-nums">{fmtScore(r.persuasion)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
