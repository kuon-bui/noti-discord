import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations, backupDbFile } from '../../src/db/migrate.js'

function tableNames(raw: import('better-sqlite3').Database): string[] {
  return raw
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all()
    .map((r) => (r as { name: string }).name)
}

describe('applyMigrations', () => {
  it('tạo đủ 4 bảng nghiệp vụ từ DB rỗng', async () => {
    const { raw, db } = openTestDb()
    await applyMigrations(db)
    const names = tableNames(raw)
    expect(names).toContain('targets')
    expect(names).toContain('checks')
    expect(names).toContain('incidents')
    expect(names).toContain('meta')
    raw.close()
  })

  it('tạo index đã khai báo', async () => {
    const { raw, db } = openTestDb()
    await applyMigrations(db)
    const idx = raw
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
      .all()
      .map((r) => (r as { name: string }).name)
    expect(idx).toContain('idx_checks_target_time')
    expect(idx).toContain('idx_incidents_target_time')
    raw.close()
  })

  it('áp lần thứ hai không làm gì và không lỗi', async () => {
    const { raw, db } = openTestDb()
    await applyMigrations(db)
    const before = tableNames(raw)
    await applyMigrations(db)
    expect(tableNames(raw)).toEqual(before)
    raw.close()
  })

  it('ràng buộc UNIQUE trên targets.name có hiệu lực', async () => {
    const { raw, db } = openTestDb()
    await applyMigrations(db)
    const insert = raw.prepare(
      `INSERT INTO targets (name, url, interval_seconds, timeout_ms, created_at, created_by)
       VALUES (?, ?, 60, 10000, '2026-08-24T00:00:00.000Z', 'u1')`,
    )
    insert.run('web', 'https://a.test')
    expect(() => insert.run('web', 'https://b.test')).toThrow(/UNIQUE/i)
    raw.close()
  })

  it('ON DELETE CASCADE xoá checks khi xoá target', async () => {
    const { raw, db } = openTestDb()
    await applyMigrations(db)
    raw.prepare(
      `INSERT INTO targets (id, name, url, interval_seconds, timeout_ms, created_at, created_by)
       VALUES (1, 'web', 'https://a.test', 60, 10000, '2026-08-24T00:00:00.000Z', 'u1')`,
    ).run()
    raw.prepare(
      `INSERT INTO checks (target_id, checked_at, status) VALUES (1, '2026-08-24T00:01:00.000Z', 'UP')`,
    ).run()
    raw.prepare(`DELETE FROM targets WHERE id = 1`).run()
    const left = raw.prepare(`SELECT count(*) AS n FROM checks`).get() as { n: number }
    expect(left.n).toBe(0)
    raw.close()
  })
})

describe('backupDbFile', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function tmpDbFile(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noti-bak-'))
    dirs.push(dir)
    const file = path.join(dir, 'monitor.db')
    fs.writeFileSync(file, 'giả lập nội dung db')
    return file
  }

  it('bỏ qua DB in-memory', () => {
    expect(backupDbFile(':memory:', new Date('2026-08-24T00:00:00.000Z'))).toBeNull()
  })

  it('bỏ qua khi file chưa tồn tại', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noti-bak-'))
    dirs.push(dir)
    expect(backupDbFile(path.join(dir, 'chua-co.db'), new Date())).toBeNull()
  })

  it('tạo bản copy có nội dung giống bản gốc', () => {
    const file = tmpDbFile()
    const dest = backupDbFile(file, new Date('2026-08-24T01:02:03.000Z'))
    expect(dest).not.toBeNull()
    expect(fs.readFileSync(dest as string, 'utf8')).toBe('giả lập nội dung db')
  })

  it('chỉ giữ 3 bản backup gần nhất', () => {
    const file = tmpDbFile()
    for (const iso of [
      '2026-08-20T00:00:00.000Z',
      '2026-08-21T00:00:00.000Z',
      '2026-08-22T00:00:00.000Z',
      '2026-08-23T00:00:00.000Z',
      '2026-08-24T00:00:00.000Z',
    ]) {
      backupDbFile(file, new Date(iso))
    }
    const backups = fs
      .readdirSync(path.dirname(file))
      .filter((f) => f.startsWith('monitor.db.bak-'))
      .sort()
    expect(backups).toHaveLength(3)
    expect(backups[0]).toContain('2026-08-22')
    expect(backups[2]).toContain('2026-08-24')
  })
})
