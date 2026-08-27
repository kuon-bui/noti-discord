import { beforeEach, describe, expect, it } from 'bun:test'
import { openTestDb } from '../../src/db/connection.js'
import { makeDestinationsRepo, type DestinationsRepo } from '../../src/db/destinations.repo.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeTargetsRepo, type TargetsRepo } from '../../src/db/targets.repo.js'

const AT = '2026-08-26T00:00:00.000Z'

describe('DestinationsRepo', () => {
  let repo: DestinationsRepo
  let targets: TargetsRepo

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    repo = makeDestinationsRepo(db)
    targets = makeTargetsRepo(db)
  })

  function target(name: string) {
    return targets.create({
      name,
      url: 'https://a.test',
      intervalSeconds: 60,
      timeoutMs: 10_000,
      createdBy: 'u1',
      createdAt: AT,
    })
  }

  it('add rồi listForTarget trả đúng row', () => {
    const web = target('web')
    expect(repo.add({ targetId: web.id, provider: 'discord', address: 'chan-1', createdAt: AT })).toBe(true)

    const rows = repo.listForTarget(web.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.provider).toBe('discord')
    expect(rows[0]?.address).toBe('chan-1')
  })

  it('targetId null là destination toàn cục, không lẫn vào listForTarget', () => {
    const web = target('web')
    repo.add({ targetId: null, provider: 'messenger', address: 'psid-1', createdAt: AT })

    expect(repo.listForTarget(web.id)).toEqual([])
    expect(repo.listGlobal().map((r) => r.address)).toEqual(['psid-1'])
  })

  it('add trùng bộ ba trả false và không tạo row thứ hai — kể cả row toàn cục', () => {
    repo.add({ targetId: null, provider: 'messenger', address: 'psid-1', createdAt: AT })
    expect(repo.add({ targetId: null, provider: 'messenger', address: 'psid-1', createdAt: AT })).toBe(false)
    expect(repo.listGlobal()).toHaveLength(1)
  })

  it('remove trả false khi không có gì để xoá', () => {
    expect(repo.remove(null, 'discord', 'không-có')).toBe(false)
  })

  it('xoá target thì cascade xoá destination của nó', () => {
    const web = target('web')
    repo.add({ targetId: web.id, provider: 'discord', address: 'chan-1', createdAt: AT })
    targets.remove('web')
    expect(repo.listForTarget(web.id)).toEqual([])
  })

  it('listByProvider chỉ trả đúng provider', () => {
    const web = target('web')
    repo.add({ targetId: web.id, provider: 'discord', address: 'chan-1', createdAt: AT })
    repo.add({ targetId: null, provider: 'messenger', address: 'psid-1', createdAt: AT })
    expect(repo.listByProvider('messenger').map((r) => r.address)).toEqual(['psid-1'])
  })
})
