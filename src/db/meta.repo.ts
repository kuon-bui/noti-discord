import { eq } from 'drizzle-orm'
import type { Db } from './connection.js'
import { meta } from './schema.js'

export type MetaRepo = {
  get(key: string): string | null
  set(key: string, value: string): void
}

export function makeMetaRepo(db: Db): MetaRepo {
  return {
    get(key) {
      const row = db.select().from(meta).where(eq(meta.key, key)).get()
      return row?.value ?? null
    },

    set(key, value) {
      db.insert(meta)
        .values({ key, value })
        .onConflictDoUpdate({ target: meta.key, set: { value } })
        .run()
    },
  }
}
