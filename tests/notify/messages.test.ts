import { describe, expect, it } from 'vitest'
import {
  COLOR_DOWN,
  COLOR_INFO,
  COLOR_UP,
  digestMessage,
  downMessage,
  manualCheckMessage,
  reasonOf,
  recoveredMessage,
} from '../../src/notify/messages.js'
import type { DigestReport, ProbeResult, Target } from '../../src/shared/types.js'

const AT = '2026-08-24T03:04:05.000Z'

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: 1,
    name: 'web-prod',
    url: 'https://a.test/health',
    method: 'GET',
    expectedStatus: '200-299',
    latencyThresholdMs: null,
    intervalSeconds: 60,
    timeoutMs: 10_000,
    alertChannelId: null,
    pausedUntil: null,
    currentStatus: 'UP',
    lastCheckedAt: null,
    createdAt: AT,
    createdBy: 'u1',
    ...overrides,
  }
}

describe('reasonOf', () => {
  it('mô tả lỗi transport', () => {
    expect(reasonOf({ ok: false, error: 'timeout sau 10000ms' })).toBe('timeout sau 10000ms')
  })

  it('mô tả status code không mong đợi', () => {
    expect(reasonOf({ ok: true, httpStatus: 503, latencyMs: 40 })).toBe('HTTP 503')
  })
})

describe('downMessage', () => {
  const message = downMessage(target(), { ok: false, error: 'timeout sau 10000ms' }, AT)

  it('dùng màu đỏ và nêu tên target trong tiêu đề', () => {
    expect(message.kind).toBe('down')
    expect(message.color).toBe(COLOR_DOWN)
    expect(message.title).toContain('web-prod')
  })

  it('đưa url và lý do vào fields', () => {
    const values = message.fields.map((field) => field.value).join('\n')
    expect(values).toContain('https://a.test/health')
    expect(values).toContain('timeout sau 10000ms')
  })

  it('giữ nguyên mốc thời gian được truyền vào', () => {
    expect(message.timestampIso).toBe(AT)
  })

  it('che credentials và query URL trong alert', () => {
    const unsafe = target({
      url: 'https://user:password@example.test/health?token=top-secret#fragment',
    })
    const values = [
      downMessage(unsafe, { ok: false, error: 'timeout' }, AT),
      recoveredMessage(unsafe, 1_000, AT),
      manualCheckMessage(
        {
          target: unsafe,
          result: { ok: true, httpStatus: 200, latencyMs: 1 },
          status: 'UP',
          transition: null,
        },
        AT,
      ),
    ]
      .flatMap((message) => message.fields)
      .map((field) => field.value)
      .join('\n')

    expect(values).toContain('https://example.test/health?…')
    expect(values).not.toContain('user')
    expect(values).not.toContain('password')
    expect(values).not.toContain('token')
    expect(values).not.toContain('top-secret')
  })
})

describe('recoveredMessage', () => {
  const message = recoveredMessage(target(), 3_725_000, AT)

  it('dùng màu xanh', () => {
    expect(message.kind).toBe('recovered')
    expect(message.color).toBe(COLOR_UP)
  })

  it('hiển thị downtime ở dạng người đọc được', () => {
    expect(message.fields.map((field) => field.value).join('\n')).toContain('1h 2m 5s')
  })
})

describe('manualCheckMessage', () => {
  it('báo UP kèm latency', () => {
    const message = manualCheckMessage(
      {
        target: target(),
        result: { ok: true, httpStatus: 200, latencyMs: 137 },
        status: 'UP',
        transition: null,
      },
      AT,
    )
    expect(message.kind).toBe('manual')
    const text = `${message.description} ${message.fields.map((field) => field.value).join(' ')}`
    expect(text).toContain('UP')
    expect(text).toContain('137')
  })

  it('báo DOWN kèm lý do', () => {
    const message = manualCheckMessage(
      {
        target: target(),
        result: { ok: false, error: 'ECONNREFUSED' },
        status: 'DOWN',
        transition: null,
      },
      AT,
    )
    expect(message.color).toBe(COLOR_DOWN)
    expect(message.fields.map((field) => field.value).join(' ')).toContain('ECONNREFUSED')
  })
})

describe('digestMessage', () => {
  const report: DigestReport = {
    rangeLabel: '24 giờ qua',
    lines: [
      {
        name: 'web-prod',
        currentStatus: 'UP',
        paused: false,
        uptimePct: 99.9,
        avgLatencyMs: 120,
        incidentCount: 1,
        downtimeMs: 65_000,
      },
      {
        name: 'api',
        currentStatus: 'DOWN',
        paused: false,
        uptimePct: 50,
        avgLatencyMs: null,
        incidentCount: 2,
        downtimeMs: 3_600_000,
      },
      {
        name: 'staging',
        currentStatus: 'UNKNOWN',
        paused: true,
        uptimePct: null,
        avgLatencyMs: null,
        incidentCount: 0,
        downtimeMs: 0,
      },
    ],
  }
  const message = digestMessage(report, AT)

  it('dùng màu info và nêu khoảng thời gian', () => {
    expect(message.kind).toBe('digest')
    expect(message.color).toBe(COLOR_INFO)
    expect(message.title).toContain('24 giờ qua')
  })

  it('liệt kê đủ mọi target trong description', () => {
    expect(message.description).toContain('web-prod')
    expect(message.description).toContain('api')
    expect(message.description).toContain('staging')
  })

  it('hiển thị uptime và đánh dấu target đang pause', () => {
    expect(message.description).toContain('99.9%')
    expect(message.description).toContain('paused')
  })

  it('target chưa có dữ liệu thì không in NaN', () => {
    expect(message.description).not.toContain('NaN')
  })
})
