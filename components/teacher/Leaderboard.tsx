import type { LeaderboardRow } from '@/lib/types'

function fmtScore(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toFixed(0)
}

function fmtBonus(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `+${v.toFixed(0)}`
}

/**
 * Ranked by calibration (plus contrarian credit when enabled), then
 * persuasion, then steelman fidelity. Never by anything else. The extra
 * columns appear only when a row carries them (flag on and scores exist).
 */
export function Leaderboard({ rows, limit }: { rows: LeaderboardRow[]; limit?: number }) {
  const shown = limit ? rows.slice(0, limit) : rows
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">No scores yet.</p>
  const showSteelman = shown.some((r) => r.steelman !== null && r.steelman !== undefined)
  const showContrarian = shown.some((r) => r.contrarian !== null && r.contrarian !== undefined)
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="py-1 pr-2">#</th>
          <th className="py-1 pr-2">Student</th>
          <th className="py-1 pr-2">Calibration</th>
          {showContrarian && <th className="py-1 pr-2">Contrarian</th>}
          <th className={showSteelman ? 'py-1 pr-2' : 'py-1'}>Persuasion</th>
          {showSteelman && <th className="py-1">Steelman</th>}
        </tr>
      </thead>
      <tbody>
        {shown.map((r, i) => (
          <tr key={`${r.name}-${i}`} className="border-t border-border">
            <td className="py-1 pr-2 tabular-nums">{i + 1}</td>
            <td className="py-1 pr-2">{r.name}</td>
            <td className="py-1 pr-2 tabular-nums">{fmtScore(r.calibration)}</td>
            {showContrarian && <td className="py-1 pr-2 tabular-nums">{fmtBonus(r.contrarian)}</td>}
            <td className={showSteelman ? 'py-1 pr-2 tabular-nums' : 'py-1 tabular-nums'}>{fmtScore(r.persuasion)}</td>
            {showSteelman && <td className="py-1 tabular-nums">{fmtScore(r.steelman)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
