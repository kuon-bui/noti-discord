import type { CheckStats, DigestLine, DigestReport, Incident, Status } from '../shared/types.js'

export type DigestInput = {
  name: string
  currentStatus: Status
  paused: boolean
  stats: CheckStats
  incidents: readonly Incident[]
}

export function sumDowntimeMs(
  incidents: readonly Incident[],
  sinceIso: string,
  nowIso: string,
): number {
  const since = Date.parse(sinceIso)
  const now = Date.parse(nowIso)

  let total = 0
  for (const incident of incidents) {
    const start = Math.max(Date.parse(incident.startedAt), since)
    const end = Math.min(incident.endedAt ? Date.parse(incident.endedAt) : now, now)
    total += Math.max(0, end - start)
  }
  return total
}

export function uptimePctOf(stats: CheckStats): number | null {
  if (stats.total === 0) return null
  return Math.round((stats.up / stats.total) * 1_000) / 10
}

const STATUS_RANK: Record<Status, number> = { DOWN: 0, DEGRADED: 1, UNKNOWN: 2, UP: 3 }

export function buildDigest(
  inputs: readonly DigestInput[],
  rangeLabel: string,
  sinceIso: string,
  nowIso: string,
): DigestReport {
  const lines: DigestLine[] = inputs.map((input) => ({
    name: input.name,
    currentStatus: input.currentStatus,
    paused: input.paused,
    uptimePct: uptimePctOf(input.stats),
    avgLatencyMs: input.stats.avgLatencyMs,
    incidentCount: input.incidents.length,
    downtimeMs: sumDowntimeMs(input.incidents, sinceIso, nowIso),
  }))

  lines.sort((left, right) => {
    const rank = STATUS_RANK[left.currentStatus] - STATUS_RANK[right.currentStatus]
    return rank !== 0 ? rank : left.name.localeCompare(right.name)
  })

  return { rangeLabel, lines }
}
