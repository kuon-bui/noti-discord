import { openDb } from '../src/db/connection.js'
import { applyMigrations } from '../src/db/migrate.js'

const dbPath = process.env.DB_PATH ?? './data/monitor.db'

const { raw, db } = openDb(dbPath)
await applyMigrations(db)
raw.close()

console.log(`Đã áp migration vào ${dbPath}`)
