import fs from 'node:fs'
import path from 'node:path'
import type Database from 'bun:sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import type { Db } from './connection.js'

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'drizzle')

export async function applyMigrations(db: Db, folder: string = MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder: folder })
}

export function hasPendingMigrations(
  raw: Database,
  folder: string = MIGRATIONS_FOLDER,
): boolean {
  const latestAvailable = readMigrationFiles({ migrationsFolder: folder }).at(-1)?.folderMillis
  if (latestAvailable === undefined) return false

  try {
    const row = raw
      .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
      .get() as { created_at: number } | undefined
    return row === undefined || Number(row.created_at) < latestAvailable
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(error.message)) return true
    throw error
  }
}

export function backupDbFile(dbPath: string, now: Date, keep = 1): string | null {
  if (dbPath === ':memory:') return null
  if (!fs.existsSync(dbPath)) return null

  // Free stale full-size copies first so a replacement fits under a tight disk quota.
  pruneBackups(dbPath, Math.max(0, keep - 1))
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const dest = `${dbPath}.bak-${stamp}`
  fs.copyFileSync(dbPath, dest)
  pruneBackups(dbPath, keep)
  return dest
}

export function pruneBackups(dbPath: string, keep = 1): void {
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) return
  const prefix = `${path.basename(dbPath)}.bak-`
  const backups = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix))
    .sort()
    .reverse()
  for (const stale of backups.slice(keep)) {
    fs.rmSync(path.join(dir, stale), { force: true })
  }
}
