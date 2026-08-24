import type { ProbeResult, Status, Target } from '../shared/types.js'

const RANGE = /^(\d{3})-(\d{3})$/
const SINGLE = /^(\d{3})$/

export function parseExpectedStatus(spec: string): { min: number; max: number } {
  const range = RANGE.exec(spec)
  if (range) {
    const min = Number(range[1])
    const max = Number(range[2])
    if (min > max) {
      throw new Error(`expected_status không hợp lệ: "${spec}" — dải phải tăng dần`)
    }
    return { min, max }
  }

  const single = SINGLE.exec(spec)
  if (single) {
    const code = Number(single[1])
    return { min: code, max: code }
  }

  throw new Error(
    `expected_status không hợp lệ: "${spec}" — chỉ nhận một dải "NNN-NNN" hoặc một mã "NNN"`,
  )
}

export function evaluate(
  result: ProbeResult,
  target: Target,
  defaultLatencyThresholdMs: number,
): Status {
  if (!result.ok) return 'DOWN'

  const { min, max } = parseExpectedStatus(target.expectedStatus)
  if (result.httpStatus < min || result.httpStatus > max) return 'DOWN'

  const threshold = target.latencyThresholdMs ?? defaultLatencyThresholdMs
  return result.latencyMs > threshold ? 'DEGRADED' : 'UP'
}
