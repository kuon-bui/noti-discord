import Database from 'bun:sqlite'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema.js'

export type Db = BunSQLiteDatabase<typeof schema>

export type OpenedDb = { raw: Database; db: Db }

export function openDb(path: string): OpenedDb {
  const raw = new Database(path)
  raw.exec('PRAGMA journal_mode = WAL')
  raw.exec('PRAGMA foreign_keys = ON')
  const db = drizzle(raw, { schema })
  return { raw, db }
}

export function openTestDb(): OpenedDb {
  const raw = new Database(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  const db = drizzle(raw, { schema })
  return { raw, db }
}
