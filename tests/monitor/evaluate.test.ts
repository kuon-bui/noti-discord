import { describe, expect, it } from 'vitest'
import { evaluate, parseExpectedStatus } from '../../src/monitor/evaluate.js'
import type { ProbeResult, Target } from '../../src/shared/types.js'

const DEFAULT_LATENCY = 2_000

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: 1,
    name: 'web',
    url: 'https://a.test',
    method: 'GET',
    expectedStatus: '200-299',
    latencyThresholdMs: null,
    intervalSeconds: 60,
    timeoutMs: 10_000,
    alertChannelId: null,
    pausedUntil: null,
    currentStatus: 'UNKNOWN',
    lastCheckedAt: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    createdBy: 'u1',
    ...overrides,
  }
}

const ok = (httpStatus: number, latencyMs: number): ProbeResult => ({
  ok: true,
  httpStatus,
  latencyMs,
})

describe('parseExpectedStatus', () => {
  it('parse dải hợp lệ', () => {
    expect(parseExpectedStatus('200-299')).toEqual({ min: 200, max: 299 })
  })

  it('parse mã đơn', () => {
    expect(parseExpectedStatus('204')).toEqual({ min: 204, max: 204 })
  })

  it('từ chối dải ngược', () => {
    expect(() => parseExpectedStatus('299-200')).toThrow(/expected_status/)
  })

  it.each(['200,204', '2xx', '20', '', ' 200 ', '200-', '1000'])('từ chối %o', (spec) => {
    expect(() => parseExpectedStatus(spec)).toThrow(/expected_status/)
  })
})

describe('evaluate', () => {
  it('lỗi transport là DOWN', () => {
    const result: ProbeResult = { ok: false, error: 'timeout sau 10000ms' }
    expect(evaluate(result, target(), DEFAULT_LATENCY)).toBe('DOWN')
  })

  it('status trong dải và nhanh là UP', () => {
    expect(evaluate(ok(200, 120), target(), DEFAULT_LATENCY)).toBe('UP')
  })

  it('status biên trên vẫn là UP', () => {
    expect(evaluate(ok(299, 10), target(), DEFAULT_LATENCY)).toBe('UP')
  })

  it('status ngoài dải là DOWN dù nhanh', () => {
    expect(evaluate(ok(500, 10), target(), DEFAULT_LATENCY)).toBe('DOWN')
  })

  it('status 301 ngoài dải 200-299 là DOWN', () => {
    expect(evaluate(ok(301, 10), target(), DEFAULT_LATENCY)).toBe('DOWN')
  })

  it('mã đơn khớp là UP, lệch là DOWN', () => {
    const configured = target({ expectedStatus: '204' })
    expect(evaluate(ok(204, 10), configured, DEFAULT_LATENCY)).toBe('UP')
    expect(evaluate(ok(200, 10), configured, DEFAULT_LATENCY)).toBe('DOWN')
  })

  it('vượt ngưỡng latency mặc định là DEGRADED', () => {
    expect(evaluate(ok(200, 2_001), target(), DEFAULT_LATENCY)).toBe('DEGRADED')
  })

  it('đúng bằng ngưỡng vẫn là UP', () => {
    expect(evaluate(ok(200, 2_000), target(), DEFAULT_LATENCY)).toBe('UP')
  })

  it('ngưỡng riêng của target thắng ngưỡng mặc định', () => {
    const configured = target({ latencyThresholdMs: 100 })
    expect(evaluate(ok(200, 150), configured, DEFAULT_LATENCY)).toBe('DEGRADED')
  })

  it('chậm nhưng status sai thì DOWN thắng DEGRADED', () => {
    expect(evaluate(ok(503, 9_000), target(), DEFAULT_LATENCY)).toBe('DOWN')
  })
})
