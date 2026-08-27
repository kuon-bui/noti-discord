import { beforeEach, describe, expect, it } from 'bun:test'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeOutboxRepo, type OutboxRepo } from '../../src/db/outbox.repo.js'
import type { AlertMessage } from '../../src/shared/types.js'

function msg(title: string): AlertMessage {
  return {
    kind: 'down',
    title,
    description: 'd',
    color: 1,
    fields: [],
    timestampIso: '2026-08-26T00:00:00.000Z',
  }
}

describe('OutboxRepo', () => {
  let repo: OutboxRepo

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    repo = makeOutboxRepo(db)
  })

  function enqueue(title: string, createdAt: string, targetName: string | null = 'api') {
    repo.enqueue({
      provider: 'messenger',
      address: 'psid-1',
      targetName,
      message: msg(title),
      createdAt,
    })
  }

  it('enqueue rồi listFor trả về theo thứ tự thời gian tăng dần', () => {
    enqueue('sau', '2026-08-26T02:00:00.000Z')
    enqueue('trước', '2026-08-26T01:00:00.000Z')

    const rows = repo.listFor('messenger', 'psid-1')
    expect(rows.map((r) => r.message.title)).toEqual(['trước', 'sau'])
    expect(rows[0]?.targetName).toBe('api')
  })

  it('không lẫn địa chỉ khác', () => {
    enqueue('của psid-1', '2026-08-26T01:00:00.000Z')
    repo.enqueue({
      provider: 'messenger',
      address: 'psid-2',
      targetName: null,
      message: msg('của psid-2'),
      createdAt: '2026-08-26T01:00:00.000Z',
    })

    expect(repo.listFor('messenger', 'psid-1')).toHaveLength(1)
  })

  it('deleteIds xoá đúng số hàng', () => {
    enqueue('a', '2026-08-26T01:00:00.000Z')
    enqueue('b', '2026-08-26T02:00:00.000Z')
    const ids = repo.listFor('messenger', 'psid-1').map((r) => r.id)

    expect(repo.deleteIds(ids)).toBe(2)
    expect(repo.listFor('messenger', 'psid-1')).toEqual([])
  })

  it('deleteIds với mảng rỗng không xoá gì và không throw', () => {
    enqueue('a', '2026-08-26T01:00:00.000Z')
    expect(repo.deleteIds([])).toBe(0)
    expect(repo.listFor('messenger', 'psid-1')).toHaveLength(1)
  })

  it('deleteOlderThan chỉ xoá hàng quá hạn của đúng địa chỉ', () => {
    enqueue('cũ', '2026-08-20T00:00:00.000Z')
    enqueue('mới', '2026-08-26T00:00:00.000Z')

    expect(repo.deleteOlderThan('messenger', 'psid-1', '2026-08-25T00:00:00.000Z')).toBe(1)
    expect(repo.listFor('messenger', 'psid-1').map((r) => r.message.title)).toEqual(['mới'])
  })

  it('payload rác bị bỏ qua, không làm sập cả hàng đợi', () => {
    const { raw, db } = openTestDb()
    // Dựng lại trên cùng kết nối để chèn được SQL thô.
    void db
    raw.exec(
      "CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, address TEXT NOT NULL, target_name TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT)",
    )
    raw.exec(
      "INSERT INTO outbox (provider, address, payload, created_at) VALUES ('messenger','psid-1','{ không phải json','2026-08-26T00:00:00.000Z')",
    )
    const local = makeOutboxRepo(db)
    expect(local.listFor('messenger', 'psid-1')).toEqual([])
  })
})
