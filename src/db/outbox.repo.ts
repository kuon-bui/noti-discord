import type { Changes } from 'bun:sqlite'
import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import type { ProviderName } from '../notify/notifier.js'
import type { AlertMessage } from '../shared/types.js'
import type { Db } from './connection.js'
import { outbox } from './schema.js'

export type OutboxEntry = {
  id: number
  provider: ProviderName
  address: string
  targetName: string | null
  message: AlertMessage
  createdAt: string
}

export type EnqueueInput = {
  provider: ProviderName
  address: string
  targetName: string | null
  message: AlertMessage
  createdAt: string
  lastError?: string | null
}

export type OutboxRepo = {
  enqueue(input: EnqueueInput): void
  /** Theo createdAt tăng dần. Hàng có payload rác bị bỏ qua. */
  listFor(provider: ProviderName, address: string): OutboxEntry[]
  deleteIds(ids: readonly number[]): number
  deleteOlderThan(provider: ProviderName, address: string, cutoffIso: string): number
}

export function makeOutboxRepo(db: Db): OutboxRepo {
  return {
    enqueue(input) {
      db.insert(outbox)
        .values({
          provider: input.provider,
          address: input.address,
          targetName: input.targetName,
          payload: JSON.stringify(input.message),
          createdAt: input.createdAt,
          lastError: input.lastError ?? null,
        })
        .run()
    },

    listFor(provider, address) {
      const rows = db
        .select()
        .from(outbox)
        .where(and(eq(outbox.provider, provider), eq(outbox.address, address)))
        .orderBy(asc(outbox.createdAt), asc(outbox.id))
        .all()

      const entries: OutboxEntry[] = []
      for (const row of rows) {
        let message: AlertMessage
        try {
          message = JSON.parse(row.payload) as AlertMessage
        } catch {
          // Payload rác không được chặn cả hàng đợi.
          continue
        }
        entries.push({
          id: row.id,
          provider: row.provider as ProviderName,
          address: row.address,
          targetName: row.targetName,
          message,
          createdAt: row.createdAt,
        })
      }
      return entries
    },

    deleteIds(ids) {
      if (ids.length === 0) return 0
      const result = db
        .delete(outbox)
        .where(inArray(outbox.id, [...ids]))
        .run() as unknown as Changes
      return result.changes
    },

    deleteOlderThan(provider, address, cutoffIso) {
      const result = db
        .delete(outbox)
        .where(
          and(
            eq(outbox.provider, provider),
            eq(outbox.address, address),
            lt(outbox.createdAt, cutoffIso),
          ),
        )
        .run() as unknown as Changes
      return result.changes
    },
  }
}
