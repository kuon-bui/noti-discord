import { formatDuration } from '../shared/time.js'
import { redactUrlForDisplay } from '../shared/url.js'
import type {
  AlertMessage,
  CheckOutcome,
  DigestReport,
  ProbeResult,
  Target,
} from '../shared/types.js'

export const COLOR_DOWN = 0xed4245
export const COLOR_UP = 0x57f287
export const COLOR_INFO = 0x5865f2
export const COLOR_WARN = 0xfee75c

export function reasonOf(result: ProbeResult): string {
  return result.ok ? `HTTP ${result.httpStatus}` : result.error
}

function latencyText(result: ProbeResult): string {
  return result.latencyMs == null ? 'không đo được' : `${result.latencyMs} ms`
}

export function downMessage(target: Target, result: ProbeResult, atIso: string): AlertMessage {
  return {
    kind: 'down',
    title: `🔴 ${target.name} đang DOWN`,
    description: 'Không đạt điều kiện kiểm tra sức khoẻ.',
    color: COLOR_DOWN,
    fields: [
      { name: 'URL', value: redactUrlForDisplay(target.url) },
      { name: 'Lý do', value: reasonOf(result) },
      { name: 'Latency', value: latencyText(result), inline: true },
      { name: 'Ngưỡng status', value: target.expectedStatus, inline: true },
    ],
    timestampIso: atIso,
  }
}

export function recoveredMessage(target: Target, downtimeMs: number, atIso: string): AlertMessage {
  return {
    kind: 'recovered',
    title: `🟢 ${target.name} đã hồi phục`,
    description: 'Kiểm tra sức khoẻ đã trở lại bình thường.',
    color: COLOR_UP,
    fields: [
      { name: 'URL', value: redactUrlForDisplay(target.url) },
      { name: 'Thời gian gián đoạn', value: formatDuration(downtimeMs), inline: true },
    ],
    timestampIso: atIso,
  }
}

export function manualCheckMessage(outcome: CheckOutcome, atIso: string): AlertMessage {
  const isDown = outcome.status === 'DOWN'
  return {
    kind: 'manual',
    title: `${isDown ? '🔴' : '🟢'} Kết quả kiểm tra ${outcome.target.name}`,
    description: `Trạng thái: **${outcome.status}**`,
    color: isDown ? COLOR_DOWN : outcome.status === 'DEGRADED' ? COLOR_WARN : COLOR_UP,
    fields: [
      { name: 'URL', value: redactUrlForDisplay(outcome.target.url) },
      { name: 'Latency', value: latencyText(outcome.result), inline: true },
      { name: 'Kết quả', value: reasonOf(outcome.result), inline: true },
    ],
    timestampIso: atIso,
  }
}

const STATUS_ICON: Record<string, string> = {
  UP: '🟢',
  DEGRADED: '🟡',
  DOWN: '🔴',
  UNKNOWN: '⚪',
}

export function digestMessage(report: DigestReport, atIso: string): AlertMessage {
  const rows = report.lines.map((line) => {
    const uptime = line.uptimePct == null ? 'chưa có dữ liệu' : `${line.uptimePct}%`
    const latency = line.avgLatencyMs == null ? '-' : `${line.avgLatencyMs}ms`
    const tag = line.paused ? ' (paused)' : ''
    return `${STATUS_ICON[line.currentStatus] ?? '⚪'} ${line.name.padEnd(16)}${uptime.padStart(14)}  ${latency.padStart(8)}  ${String(line.incidentCount).padStart(3)} sự cố  ${formatDuration(line.downtimeMs)}${tag}`
  })

  const body = rows.length > 0 ? rows.join('\n') : 'Chưa có target nào được theo dõi.'

  return {
    kind: 'digest',
    title: `📊 Báo cáo tình trạng — ${report.rangeLabel}`,
    description: `\`\`\`\n${body}\n\`\`\``,
    color: COLOR_INFO,
    fields: [{ name: 'Số target', value: String(report.lines.length), inline: true }],
    timestampIso: atIso,
  }
}
