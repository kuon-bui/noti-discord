import fs from 'node:fs'
import nodePath from 'node:path'
import Database from 'bun:sqlite'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema.js'

export type Db = BunSQLiteDatabase<typeof schema>

export type OpenedDb = { raw: Database; db: Db }

export function openDb(dbPath: string): OpenedDb {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(nodePath.dirname(nodePath.resolve(dbPath)), { recursive: true })
  }
  const raw = new Database(dbPath)
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
