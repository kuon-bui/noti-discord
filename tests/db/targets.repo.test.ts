import { beforeEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import {
  makeTargetsRepo,
  type CreateTargetInput,
  type TargetsRepo,
} from '../../src/db/targets.repo.js'

const AT = '2026-08-24T00:00:00.000Z'

function input(overrides: Partial<CreateTargetInput> = {}): CreateTargetInput {
  return {
    name: 'web',
    url: 'https://a.test',
    intervalSeconds: 60,
    timeoutMs: 10_000,
    createdBy: 'u1',
    createdAt: AT,
    ...overrides,
  }
}

describe('TargetsRepo', () => {
  let repo: TargetsRepo

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    repo = makeTargetsRepo(db)
  })

  it('create trả về target đầy đủ với default đã áp', () => {
    const target = repo.create(input())
    expect(target.id).toBeGreaterThan(0)
    expect(target.name).toBe('web')
    expect(target.method).toBe('GET')
    expect(target.expectedStatus).toBe('200-299')
    expect(target.currentStatus).toBe('UNKNOWN')
    expect(target.latencyThresholdMs).toBeNull()
    expect(target.alertChannelId).toBeNull()
    expect(target.pausedUntil).toBeNull()
    expect(target.lastCheckedAt).toBeNull()
  })

  it('create nhận giá trị tuỳ chọn', () => {
    const target = repo.create(
      input({ latencyThresholdMs: 500, alertChannelId: '999', expectedStatus: '204' }),
    )
    expect(target.latencyThresholdMs).toBe(500)
    expect(target.alertChannelId).toBe('999')
    expect(target.expectedStatus).toBe('204')
  })

  it('create trùng tên thì throw', () => {
    repo.create(input())
    expect(() => repo.create(input())).toThrow(/UNIQUE/i)
  })

  it('findByName trả null khi không có', () => {
    expect(repo.findByName('không-có')).toBeNull()
  })

  it('findByName tìm được target vừa tạo', () => {
    repo.create(input())
    expect(repo.findByName('web')?.url).toBe('https://a.test')
  })

  it('findById tìm được và trả null khi thiếu', () => {
    const target = repo.create(input())
    expect(repo.findById(target.id)?.name).toBe('web')
    expect(repo.findById(9_999)).toBeNull()
  })

  it('findAll sắp xếp theo tên', () => {
    repo.create(input({ name: 'zulu' }))
    repo.create(input({ name: 'alpha' }))
    expect(repo.findAll().map((target) => target.name)).toEqual(['alpha', 'zulu'])
  })

  it('findDue trả target chưa từng check', () => {
    repo.create(input())
    expect(repo.findDue('2026-08-24T00:00:00.000Z').map((target) => target.name)).toEqual([
      'web',
    ])
  })

  it('findDue bỏ target vừa check chưa tới hạn', () => {
    const target = repo.create(input({ intervalSeconds: 60 }))
    repo.updateStatus(target.id, 'UP', '2026-08-24T00:00:00.000Z')
    expect(repo.findDue('2026-08-24T00:00:30.000Z')).toEqual([])
  })

  it('findDue trả target đã đủ interval', () => {
    const target = repo.create(input({ intervalSeconds: 60 }))
    repo.updateStatus(target.id, 'UP', '2026-08-24T00:00:00.000Z')
    expect(repo.findDue('2026-08-24T00:01:00.000Z').map((due) => due.name)).toEqual(['web'])
  })

  it('findDue bỏ target đang pause dù đã tới hạn', () => {
    const target = repo.create(input())
    repo.setPause(target.id, '2026-08-24T01:00:00.000Z')
    expect(repo.findDue('2026-08-24T00:30:00.000Z')).toEqual([])
  })

  it('findDue trả lại target sau khi pause hết hạn, không cần resume', () => {
    const target = repo.create(input())
    repo.setPause(target.id, '2026-08-24T01:00:00.000Z')
    expect(repo.findDue('2026-08-24T01:00:01.000Z').map((due) => due.name)).toEqual(['web'])
  })

  it('setPause với null thì bỏ pause', () => {
    const target = repo.create(input())
    repo.setPause(target.id, '2026-08-24T01:00:00.000Z')
    repo.setPause(target.id, null)
    expect(repo.findById(target.id)?.pausedUntil).toBeNull()
    expect(repo.findDue('2026-08-24T00:30:00.000Z')).toHaveLength(1)
  })

  it('updateStatus ghi cả status và lastCheckedAt', () => {
    const target = repo.create(input())
    repo.updateStatus(target.id, 'DEGRADED', '2026-08-24T00:05:00.000Z')
    const after = repo.findById(target.id)
    expect(after?.currentStatus).toBe('DEGRADED')
    expect(after?.lastCheckedAt).toBe('2026-08-24T00:05:00.000Z')
  })

  it('remove trả true khi xoá được, false khi không có', () => {
    repo.create(input())
    expect(repo.remove('web')).toBe(true)
    expect(repo.remove('web')).toBe(false)
    expect(repo.findAll()).toEqual([])
  })
})
