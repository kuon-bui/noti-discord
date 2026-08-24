import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

export type Db = BetterSQLite3Database<typeof schema>

export type OpenedDb = { raw: Database.Database; db: Db }

export function openDb(path: string): OpenedDb {
  const raw = new Database(path)
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')
  const db = drizzle(raw, { schema })
  return { raw, db }
}

export function openTestDb(): OpenedDb {
  const raw = new Database(':memory:')
  raw.pragma('foreign_keys = ON')
  const db = drizzle(raw, { schema })
  return { raw, db }
}
