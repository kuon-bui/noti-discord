import { beforeEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeChecksRepo, type ChecksRepo } from '../../src/db/checks.repo.js'
import { makeTargetsRepo } from '../../src/db/targets.repo.js'

describe('ChecksRepo', () => {
  let repo: ChecksRepo
  let targetId: number

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    repo = makeChecksRepo(db)
    targetId = makeTargetsRepo(db).create({
      name: 'web',
      url: 'https://a.test',
      intervalSeconds: 60,
      timeoutMs: 10_000,
      createdBy: 'u1',
      createdAt: '2026-08-24T00:00:00.000Z',
    }).id
  })

  it('insert rồi listRecent trả bản mới nhất trước', () => {
    repo.insert({
      targetId,
      checkedAt: '2026-08-24T00:01:00.000Z',
      status: 'UP',
      httpStatus: 200,
      latencyMs: 120,
    })
    repo.insert({
      targetId,
      checkedAt: '2026-08-24T00:02:00.000Z',
      status: 'DOWN',
      error: 'timeout',
    })
    const rows = repo.listRecent(targetId, 10)
    expect(rows.map((row) => row.status)).toEqual(['DOWN', 'UP'])
    expect(rows[0]?.error).toBe('timeout')
    expect(rows[0]?.httpStatus).toBeNull()
    expect(rows[1]?.latencyMs).toBe(120)
  })

  it('listRecent tôn trọng limit', () => {
    for (let i = 1; i <= 5; i++) {
      repo.insert({
        targetId,
        checkedAt: `2026-08-24T00:0${i}:00.000Z`,
        status: 'UP',
        latencyMs: 100,
      })
    }
    expect(repo.listRecent(targetId, 2)).toHaveLength(2)
  })

  it('statsSince không có dữ liệu thì trả 0 và avg null', () => {
    expect(repo.statsSince(targetId, '2026-08-24T00:00:00.000Z')).toEqual({
      total: 0,
      up: 0,
      down: 0,
      avgLatencyMs: null,
    })
  })

  it('statsSince tính DEGRADED là up', () => {
    repo.insert({
      targetId,
      checkedAt: '2026-08-24T01:00:00.000Z',
      status: 'UP',
      latencyMs: 100,
    })
    repo.insert({
      targetId,
      checkedAt: '2026-08-24T01:01:00.000Z',
      status: 'DEGRADED',
      latencyMs: 3_000,
    })
    repo.insert({ targetId, checkedAt: '2026-08-24T01:02:00.000Z', status: 'DOWN' })
    const stats = repo.statsSince(targetId, '2026-08-24T00:00:00.000Z')
    expect(stats.total).toBe(3)
    expect(stats.up).toBe(2)
    expect(stats.down).toBe(1)
    expect(stats.avgLatencyMs).toBe(1_550)
  })

  it('statsSince loại bản ghi cũ hơn mốc since', () => {
    repo.insert({ targetId, checkedAt: '2026-08-23T00:00:00.000Z', status: 'DOWN' })
    repo.insert({
      targetId,
      checkedAt: '2026-08-24T01:00:00.000Z',
      status: 'UP',
      latencyMs: 200,
    })
    const stats = repo.statsSince(targetId, '2026-08-24T00:00:00.000Z')
    expect(stats.total).toBe(1)
    expect(stats.up).toBe(1)
  })

  it('deleteOlderThan xoá đúng số dòng và giữ dòng mới', () => {
    repo.insert({
      targetId,
      checkedAt: '2026-07-01T00:00:00.000Z',
      status: 'UP',
      latencyMs: 100,
    })
    repo.insert({
      targetId,
      checkedAt: '2026-07-02T00:00:00.000Z',
      status: 'UP',
      latencyMs: 100,
    })
    repo.insert({
      targetId,
      checkedAt: '2026-08-24T00:00:00.000Z',
      status: 'UP',
      latencyMs: 100,
    })
    expect(repo.deleteOlderThan('2026-08-01T00:00:00.000Z')).toBe(2)
    expect(repo.listRecent(targetId, 10)).toHaveLength(1)
  })
})
