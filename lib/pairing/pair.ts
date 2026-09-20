/**
 * Debate-group formation by maximum belief disparity (hackmit-plan.md §4,
 * phase 3). Pure and deterministic: same input, same groups.
 *
 * 1. Sizes: k = floor(N/3). Remainder 1 → one group of 4. Remainder 2 → two
 *    groups of 4, or one group of 5 when k = 1 (N = 5 is one group of 5).
 *    Never a group of 2. Fewer than 3 students → one group.
 * 2. Sort by belief (non-submitters placed at 50), tiebreak by participant id.
 *    The k lowest go to groups 0..k−1, the k highest to groups k−1..0, and the
 *    rest go one at a time to the group with spare capacity and the smallest
 *    spread (max − min).
 * 3. Speaking order inside a group: submitters by |belief − 50| ascending
 *    (least sure speaks first), then non-submitters; ties by participant id.
 *
 * Cluster-diversity swaps (plan §4 secondary criterion) are P1 and not here.
 */

export interface PairingInput {
  participantId: string
  /** Blind belief in percent, or null if the student never submitted. */
  blindPct: number | null
}

export interface DebateGroup {
  idx: number
  /** Participant ids in speaking order; also the member list. */
  turnOrder: string[]
}

/** Target group sizes for N students, per the rules above. */
export function groupSizes(n: number): number[] {
  if (n <= 0) return []
  if (n < 3) return [n]
  const k = Math.floor(n / 3)
  const r = n % 3
  const sizes = new Array<number>(k).fill(3)
  if (r === 1) sizes[0] = 4
  if (r === 2) {
    if (k >= 2) {
      sizes[0] = 4
      sizes[1] = 4
    } else {
      sizes[0] = 5
    }
  }
  return sizes
}

const placement = (m: PairingInput): number => (m.blindPct === null ? 50 : m.blindPct)

function byBeliefThenId(a: PairingInput, b: PairingInput): number {
  return placement(a) - placement(b) || a.participantId.localeCompare(b.participantId)
}

function turnOrder(members: PairingInput[]): string[] {
  return [...members]
    .sort((a, b) => {
      const aNull = a.blindPct === null
      const bNull = b.blindPct === null
      if (aNull !== bNull) return aNull ? 1 : -1
      const da = Math.abs(placement(a) - 50)
      const db = Math.abs(placement(b) - 50)
      return da - db || a.participantId.localeCompare(b.participantId)
    })
    .map((m) => m.participantId)
}

export function pairStudents(input: readonly PairingInput[]): DebateGroup[] {
  const students = [...input].sort(byBeliefThenId)
  const n = students.length
  const sizes = groupSizes(n)
  if (sizes.length === 0) return []

  const k = sizes.length
  const groups: PairingInput[][] = sizes.map(() => [])

  if (n < 3) {
    return [{ idx: 0, turnOrder: turnOrder(students) }]
  }

  // Lowest k → groups 0..k−1; highest k → groups k−1..0.
  for (let i = 0; i < k; i++) {
    groups[i].push(students[i])
    groups[k - 1 - i].push(students[n - 1 - i])
  }

  // Remaining middle students → group with capacity and the smallest spread.
  const middle = students.slice(k, n - k)
  const spread = (g: PairingInput[]): number => {
    if (g.length === 0) return 0
    const vals = g.map(placement)
    return Math.max(...vals) - Math.min(...vals)
  }
  for (const m of middle) {
    let best = -1
    let bestSpread = Infinity
    for (let gi = 0; gi < k; gi++) {
      if (groups[gi].length >= sizes[gi]) continue
      const s = spread(groups[gi])
      if (s < bestSpread) {
        bestSpread = s
        best = gi
      }
    }
    if (best === -1) throw new Error('pairing: no group with capacity (bug in groupSizes)')
    groups[best].push(m)
  }

  return groups.map((members, idx) => ({ idx, turnOrder: turnOrder(members) }))
}
