import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const valid = {
  DISCORD_TOKEN: 'tok',
  DISCORD_CLIENT_ID: '111',
  GUILD_ID: '222',
  DEFAULT_ALERT_CHANNEL_ID: '333',
  DIGEST_CHANNEL_ID: '444',
  ADMIN_USER_IDS: '555,666',
}

describe('loadConfig', () => {
  it('parse env hợp lệ và gán default', () => {
    const c = loadConfig(valid)
    expect(c.discordToken).toBe('tok')
    expect(c.adminUserIds).toEqual(['555', '666'])
    expect(c.dbPath).toBe('./data/monitor.db')
    expect(c.digestHourLocal).toBe(9)
    expect(c.defaultIntervalSeconds).toBe(60)
    expect(c.defaultTimeoutMs).toBe(10_000)
    expect(c.defaultLatencyThresholdMs).toBe(2_000)
    expect(c.checkRetentionDays).toBe(30)
    expect(c.maxConcurrentChecks).toBe(5)
    expect(c.tickIntervalMs).toBe(10_000)
    expect(c.logLevel).toBe('info')
  })

  it('thiếu DISCORD_TOKEN thì báo lỗi nêu rõ tên biến', () => {
    const { DISCORD_TOKEN: _drop, ...rest } = valid
    expect(() => loadConfig(rest)).toThrow(/DISCORD_TOKEN/)
  })

  it('ADMIN_USER_IDS rỗng thì báo lỗi', () => {
    expect(() => loadConfig({ ...valid, ADMIN_USER_IDS: '' })).toThrow(/ADMIN_USER_IDS/)
  })

  it('cắt khoảng trắng và bỏ phần tử rỗng trong ADMIN_USER_IDS', () => {
    expect(loadConfig({ ...valid, ADMIN_USER_IDS: ' 555 , ,666 ' }).adminUserIds)
      .toEqual(['555', '666'])
  })

  it('ghi đè được default bằng env', () => {
    const c = loadConfig({ ...valid, DB_PATH: '/tmp/x.db', DIGEST_HOUR_LOCAL: '7', LOG_LEVEL: 'debug' })
    expect(c.dbPath).toBe('/tmp/x.db')
    expect(c.digestHourLocal).toBe(7)
    expect(c.logLevel).toBe('debug')
  })

  it('số sai định dạng thì báo lỗi nêu rõ tên biến', () => {
    expect(() => loadConfig({ ...valid, TICK_INTERVAL_MS: 'nhanh' })).toThrow(/TICK_INTERVAL_MS/)
  })

  it('DIGEST_HOUR_LOCAL ngoài 0-23 thì báo lỗi', () => {
    expect(() => loadConfig({ ...valid, DIGEST_HOUR_LOCAL: '25' })).toThrow(/DIGEST_HOUR_LOCAL/)
  })

  it('LOG_LEVEL không hợp lệ thì báo lỗi', () => {
    expect(() => loadConfig({ ...valid, LOG_LEVEL: 'ồn ào' })).toThrow(/LOG_LEVEL/)
  })

  it('config trả về là readonly ở mức runtime', () => {
    const c = loadConfig(valid)
    expect(Object.isFrozen(c)).toBe(true)
  })
})
