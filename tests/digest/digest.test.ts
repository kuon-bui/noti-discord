import { describe, expect, it } from 'vitest'
import {
  buildDigest,
  sumDowntimeMs,
  uptimePctOf,
  type DigestInput,
} from '../../src/digest/digest.js'
import type { Incident } from '../../src/shared/types.js'

const SINCE = '2026-08-24T00:00:00.000Z'
const NOW = '2026-08-25T00:00:00.000Z'

function incident(startedAt: string, endedAt: string | null, id = 1): Incident {
  return { id, targetId: 1, startedAt, endedAt, reason: 'timeout' }
}

describe('sumDowntimeMs', () => {
  it('không có incident thì bằng 0', () => {
    expect(sumDowntimeMs([], SINCE, NOW)).toBe(0)
  })

  it('incident nằm trọn trong khoảng', () => {
    expect(
      sumDowntimeMs(
        [incident('2026-08-24T01:00:00.000Z', '2026-08-24T01:30:00.000Z')],
        SINCE,
        NOW,
      ),
    ).toBe(30 * 60_000)
  })

  it('cắt phần bắt đầu trước mốc since', () => {
    expect(
      sumDowntimeMs(
        [incident('2026-08-23T23:00:00.000Z', '2026-08-24T00:30:00.000Z')],
        SINCE,
        NOW,
      ),
    ).toBe(30 * 60_000)
  })

  it('incident còn mở thì tính tới now', () => {
    expect(sumDowntimeMs([incident('2026-08-24T23:00:00.000Z', null)], SINCE, NOW)).toBe(
      60 * 60_000,
    )
  })

  it('cắt phần kết thúc sau mốc now', () => {
    expect(
      sumDowntimeMs(
        [incident('2026-08-24T23:00:00.000Z', '2026-08-26T00:00:00.000Z')],
        SINCE,
        NOW,
      ),
    ).toBe(60 * 60_000)
  })

  it('bỏ incident kết thúc trước mốc since', () => {
    expect(
      sumDowntimeMs(
        [incident('2026-08-20T00:00:00.000Z', '2026-08-21T00:00:00.000Z')],
        SINCE,
        NOW,
      ),
    ).toBe(0)
  })

  it('cộng nhiều incident', () => {
    const incidents = [
      incident('2026-08-24T01:00:00.000Z', '2026-08-24T01:10:00.000Z', 1),
      incident('2026-08-24T05:00:00.000Z', '2026-08-24T05:20:00.000Z', 2),
    ]
    expect(sumDowntimeMs(incidents, SINCE, NOW)).toBe(30 * 60_000)
  })
})

describe('uptimePctOf', () => {
  it('không có check thì trả null, không phải 0', () => {
    expect(uptimePctOf({ total: 0, up: 0, down: 0, avgLatencyMs: null })).toBeNull()
  })

  it('toàn bộ UP là 100', () => {
    expect(uptimePctOf({ total: 10, up: 10, down: 0, avgLatencyMs: 100 })).toBe(100)
  })

  it('toàn bộ DOWN là 0', () => {
    expect(uptimePctOf({ total: 10, up: 0, down: 10, avgLatencyMs: null })).toBe(0)
  })

  it('làm tròn tới một chữ số thập phân', () => {
    expect(uptimePctOf({ total: 1_000, up: 999, down: 1, avgLatencyMs: 100 })).toBe(99.9)
    expect(uptimePctOf({ total: 3, up: 2, down: 1, avgLatencyMs: 100 })).toBe(66.7)
  })
})

describe('buildDigest', () => {
  function input(overrides: Partial<DigestInput> = {}): DigestInput {
    return {
      name: 'web',
      currentStatus: 'UP',
      paused: false,
      stats: { total: 100, up: 99, down: 1, avgLatencyMs: 120 },
      incidents: [incident('2026-08-24T01:00:00.000Z', '2026-08-24T01:01:00.000Z')],
      ...overrides,
    }
  }

  it('giữ nguyên nhãn khoảng thời gian', () => {
    expect(buildDigest([input()], '24 giờ qua', SINCE, NOW).rangeLabel).toBe('24 giờ qua')
  })

  it('dựng đủ số liệu cho một target', () => {
    const line = buildDigest([input()], '24 giờ qua', SINCE, NOW).lines[0]
    expect(line?.name).toBe('web')
    expect(line?.uptimePct).toBe(99)
    expect(line?.avgLatencyMs).toBe(120)
    expect(line?.incidentCount).toBe(1)
    expect(line?.downtimeMs).toBe(60_000)
  })

  it('danh sách rỗng cho report rỗng', () => {
    expect(buildDigest([], '24 giờ qua', SINCE, NOW).lines).toEqual([])
  })

  it('xếp DOWN lên trước, rồi DEGRADED, rồi theo tên', () => {
    const inputs = [
      input({ name: 'zulu', currentStatus: 'UP' }),
      input({ name: 'api', currentStatus: 'DOWN' }),
      input({ name: 'cache', currentStatus: 'DEGRADED' }),
      input({ name: 'alpha', currentStatus: 'UP' }),
    ]
    expect(buildDigest(inputs, '24 giờ qua', SINCE, NOW).lines.map((line) => line.name)).toEqual([
      'api',
      'cache',
      'alpha',
      'zulu',
    ])
  })

  it('giữ cờ paused', () => {
    const line = buildDigest([input({ paused: true })], '24 giờ qua', SINCE, NOW).lines[0]
    expect(line?.paused).toBe(true)
  })

  it('target chưa có check thì uptimePct là null', () => {
    const line = buildDigest(
      [input({ stats: { total: 0, up: 0, down: 0, avgLatencyMs: null }, incidents: [] })],
      '24 giờ qua',
      SINCE,
      NOW,
    ).lines[0]
    expect(line?.uptimePct).toBeNull()
    expect(line?.downtimeMs).toBe(0)
  })
})
