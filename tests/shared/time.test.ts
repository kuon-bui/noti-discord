import { describe, expect, it } from 'bun:test'
import { formatDuration, vnDateString, vnHour } from '../../src/shared/time.js'

describe('vnDateString', () => {
  it('trả ngày theo giờ VN', () => {
    expect(vnDateString(new Date('2026-08-24T01:30:00.000Z'))).toBe('2026-08-24')
  })

  it('UTC còn hôm trước nhưng VN đã sang ngày mới', () => {
    expect(vnDateString(new Date('2026-08-23T17:30:00.000Z'))).toBe('2026-08-24')
  })

  it('UTC đã sang ngày mới nhưng VN còn hôm trước là không thể (VN = UTC+7)', () => {
    expect(vnDateString(new Date('2026-08-24T00:00:00.000Z'))).toBe('2026-08-24')
  })
})

describe('vnHour', () => {
  it('01:30Z là 8 giờ VN', () => {
    expect(vnHour(new Date('2026-08-24T01:30:00.000Z'))).toBe(8)
  })

  it('17:30Z là 0 giờ VN, không phải 24', () => {
    expect(vnHour(new Date('2026-08-23T17:30:00.000Z'))).toBe(0)
  })

  it('02:00Z là 9 giờ VN — đúng mốc gửi digest', () => {
    expect(vnHour(new Date('2026-08-24T02:00:00.000Z'))).toBe(9)
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [999, '0s'],
    [5_000, '5s'],
    [65_000, '1m 5s'],
    [3_725_000, '1h 2m 5s'],
    [90_061_000, '1d 1h 1m 1s'],
  ])('%i ms -> %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})