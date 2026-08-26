import { beforeEach, describe, expect, it } from 'bun:test'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeIncidentsRepo, type IncidentsRepo } from '../../src/db/incidents.repo.js'
import { makeTargetsRepo } from '../../src/db/targets.repo.js'

describe('IncidentsRepo', () => {
  let repo: IncidentsRepo
  let targetId: number

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    repo = makeIncidentsRepo(db)
    targetId = makeTargetsRepo(db).create({
      name: 'web',
      url: 'https://a.test',
      intervalSeconds: 60,
      timeoutMs: 10_000,
      createdBy: 'u1',
      createdAt: '2026-08-24T00:00:00.000Z',
    }).id
  })

  it('open tạo incident chưa đóng', () => {
    const incident = repo.open(targetId, 'HTTP 500', '2026-08-24T01:00:00.000Z')
    expect(incident.startedAt).toBe('2026-08-24T01:00:00.000Z')
    expect(incident.endedAt).toBeNull()
    expect(incident.reason).toBe('HTTP 500')
  })

  it('findOpen trả incident đang mở, null khi không có', () => {
    expect(repo.findOpen(targetId)).toBeNull()
    repo.open(targetId, 'timeout', '2026-08-24T01:00:00.000Z')
    expect(repo.findOpen(targetId)?.reason).toBe('timeout')
  })

  it('close đóng incident đang mở và trả bản đã đóng', () => {
    repo.open(targetId, 'timeout', '2026-08-24T01:00:00.000Z')
    const closed = repo.close(targetId, '2026-08-24T01:30:00.000Z')
    expect(closed?.endedAt).toBe('2026-08-24T01:30:00.000Z')
    expect(repo.findOpen(targetId)).toBeNull()
  })

  it('close khi không có incident mở thì trả null', () => {
    expect(repo.close(targetId, '2026-08-24T01:30:00.000Z')).toBeNull()
  })

  it('open hai lần liên tiếp không tạo incident thứ hai', () => {
    repo.open(targetId, 'lần 1', '2026-08-24T01:00:00.000Z')
    const again = repo.open(targetId, 'lần 2', '2026-08-24T01:05:00.000Z')
    expect(again.startedAt).toBe('2026-08-24T01:00:00.000Z')
    expect(repo.listRecent(targetId, 10)).toHaveLength(1)
  })

  it('listRecent trả mới nhất trước', () => {
    repo.open(targetId, 'a', '2026-08-24T01:00:00.000Z')
    repo.close(targetId, '2026-08-24T01:10:00.000Z')
    repo.open(targetId, 'b', '2026-08-24T02:00:00.000Z')
    expect(repo.listRecent(targetId, 10).map((incident) => incident.reason)).toEqual(['b', 'a'])
  })

  it('listOverlapping lấy incident còn mở dù bắt đầu trước mốc since', () => {
    repo.open(targetId, 'dài', '2026-08-20T00:00:00.000Z')
    const found = repo.listOverlapping(targetId, '2026-08-24T00:00:00.000Z')
    expect(found).toHaveLength(1)
    expect(found[0]?.endedAt).toBeNull()
  })

  it('listOverlapping lấy incident kết thúc trong khoảng', () => {
    repo.open(targetId, 'trong khoảng', '2026-08-23T23:00:00.000Z')
    repo.close(targetId, '2026-08-24T00:30:00.000Z')
    expect(repo.listOverlapping(targetId, '2026-08-24T00:00:00.000Z')).toHaveLength(1)
  })

  it('listOverlapping bỏ incident đã kết thúc trước mốc since', () => {
    repo.open(targetId, 'cũ', '2026-08-20T00:00:00.000Z')
    repo.close(targetId, '2026-08-21T00:00:00.000Z')
    expect(repo.listOverlapping(targetId, '2026-08-24T00:00:00.000Z')).toEqual([])
  })
})
