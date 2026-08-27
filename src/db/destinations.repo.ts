import type { Changes } from 'bun:sqlite'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { ProviderName } from '../notify/notifier.js'
import type { Db } from './connection.js'
import { destinations } from './schema.js'

export type DestinationRow = {
  id: number
  targetId: number | null
  provider: ProviderName
  address: string
}

export type AddDestinationInput = {
  targetId: number | null
  provider: ProviderName
  address: string
  createdAt: string
}

export type DestinationsRepo = {
  /** Trả false nếu bộ ba (targetId, provider, address) đã tồn tại. */
  add(input: AddDestinationInput): boolean
  remove(targetId: number | null, provider: ProviderName, address: string): boolean
  listForTarget(targetId: number): DestinationRow[]
  listGlobal(): DestinationRow[]
  listByProvider(provider: ProviderName): DestinationRow[]
}

type Row = typeof destinations.$inferSelect

function toRow(row: Row): DestinationRow {
  return {
    id: row.id,
    targetId: row.targetId,
    provider: row.provider as ProviderName,
    address: row.address,
  }
}

function matches(targetId: number | null, provider: ProviderName, address: string) {
  return and(
    targetId === null ? isNull(destinations.targetId) : eq(destinations.targetId, targetId),
    eq(destinations.provider, provider),
    eq(destinations.address, address),
  )
}

export function makeDestinationsRepo(db: Db): DestinationsRepo {
  return {
    add(input) {
      const existing = db
        .select()
        .from(destinations)
        .where(matches(input.targetId, input.provider, input.address))
        .get()
      if (existing) return false

      db.insert(destinations)
        .values({
          targetId: input.targetId,
          provider: input.provider,
          address: input.address,
          createdAt: input.createdAt,
        })
        .run()
      return true
    },

    remove(targetId, provider, address) {
      const result = db
        .delete(destinations)
        .where(matches(targetId, provider, address))
        .run() as unknown as Changes
      return result.changes > 0
    },

    listForTarget(targetId) {
      return db
        .select()
        .from(destinations)
        .where(eq(destinations.targetId, targetId))
        .orderBy(asc(destinations.id))
        .all()
        .map(toRow)
    },

    listGlobal() {
      return db
        .select()
        .from(destinations)
        .where(isNull(destinations.targetId))
        .orderBy(asc(destinations.id))
        .all()
        .map(toRow)
    },

    listByProvider(provider) {
      return db
        .select()
        .from(destinations)
        .where(eq(destinations.provider, provider))
        .orderBy(asc(destinations.id))
        .all()
        .map(toRow)
    },
  }
}
