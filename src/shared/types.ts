export type Status = 'UP' | 'DEGRADED' | 'DOWN' | 'UNKNOWN'

export type Target = {
  id: number
  name: string
  url: string
  method: string
  expectedStatus: string
  latencyThresholdMs: number | null
  intervalSeconds: number
  timeoutMs: number
  pausedUntil: string | null
  currentStatus: Status
  lastCheckedAt: string | null
  createdAt: string
  createdBy: string
}

export type ProbeResult =
  | { ok: true; httpStatus: number; latencyMs: number }
  | { ok: false; httpStatus?: number; latencyMs?: number; error: string }

export type Transition = { kind: 'down' } | { kind: 'recovered' }

export type CheckOutcome = {
  target: Target
  result: ProbeResult
  status: Status
  transition: Transition | null
}

export type AlertField = { name: string; value: string; inline?: boolean }

export type AlertMessage = {
  kind: 'down' | 'recovered' | 'manual' | 'digest'
  title: string
  description: string
  color: number
  fields: AlertField[]
  timestampIso: string
  /** Tên target liên quan, để outbox gộp được theo target. Digest không có. */
  targetName?: string
  /** Dữ liệu bảng chưa format. Provider tự render. 6 ô: icon, name, uptime, latency, incidents, downtime. */
  table?: { rows: string[][] }
}

export type Incident = {
  id: number
  targetId: number
  startedAt: string
  endedAt: string | null
  reason: string | null
}

export type CheckStats = {
  total: number
  up: number
  down: number
  avgLatencyMs: number | null
}

export type DigestLine = {
  name: string
  currentStatus: Status
  paused: boolean
  uptimePct: number | null
  avgLatencyMs: number | null
  incidentCount: number
  downtimeMs: number
}

export type DigestReport = {
  rangeLabel: string
  lines: DigestLine[]
}