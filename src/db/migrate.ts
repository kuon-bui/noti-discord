import fs from 'node:fs'
import path from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { Db } from './connection.js'

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'drizzle')

export async function applyMigrations(db: Db, folder: string = MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder: folder })
}

export function backupDbFile(dbPath: string, now: Date, keep = 3): string | null {
  if (dbPath === ':memory:') return null
  if (!fs.existsSync(dbPath)) return null

  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const dest = `${dbPath}.bak-${stamp}`
  fs.copyFileSync(dbPath, dest)
  pruneBackups(dbPath, keep)
  return dest
}

function pruneBackups(dbPath: string, keep: number): void {
  const dir = path.dirname(dbPath)
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
