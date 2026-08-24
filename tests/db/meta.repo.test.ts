import { beforeEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeMetaRepo, type MetaRepo } from '../../src/db/meta.repo.js'

describe('MetaRepo', () => {
  let repo: MetaRepo

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    repo = makeMetaRepo(db)
  })

  it('get trả null khi chưa có key', () => {
    expect(repo.get('last_digest_date')).toBeNull()
  })

  it('set rồi get trả đúng giá trị', () => {
    repo.set('last_digest_date', '2026-08-24')
    expect(repo.get('last_digest_date')).toBe('2026-08-24')
  })

  it('set lần hai ghi đè, không lỗi trùng khoá', () => {
    repo.set('last_digest_date', '2026-08-24')
    repo.set('last_digest_date', '2026-08-25')
    expect(repo.get('last_digest_date')).toBe('2026-08-25')
  })
})
