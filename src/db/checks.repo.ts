import type { Changes } from 'bun:sqlite'
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import type { CheckStats, Status } from '../shared/types.js'
import type { Db } from './connection.js'
import { checks } from './schema.js'

export type InsertCheckInput = {
  targetId: number
  checkedAt: string
  status: Status
  httpStatus?: number | null
  latencyMs?: number | null
  error?: string | null
}

export type CheckRow = {
  id: number
  targetId: number
  checkedAt: string
  status: Status
  httpStatus: number | null
  latencyMs: number | null
  error: string | null
}

export type ChecksRepo = {
  insert(input: InsertCheckInput): void
  listRecent(targetId: number, limit: number): CheckRow[]
  statsSince(targetId: number, sinceIso: string): CheckStats
  deleteOlderThan(cutoffIso: string): number
}

export function makeChecksRepo(db: Db): ChecksRepo {
  return {
    insert(input) {
      db.insert(checks)
        .values({
          targetId: input.targetId,
          checkedAt: input.checkedAt,
          status: input.status,
          httpStatus: input.httpStatus ?? null,
          latencyMs: input.latencyMs ?? null,
          error: input.error ?? null,
        })
        .run()
    },

    listRecent(targetId, limit) {
      return db
        .select()
        .from(checks)
        .where(eq(checks.targetId, targetId))
        .orderBy(desc(checks.checkedAt), desc(checks.id))
        .limit(limit)
        .all()
        .map((row) => ({ ...row, status: row.status as Status }))
    },

    statsSince(targetId, sinceIso) {
      const row = db
        .select({
          total: sql<number>`count(*)`,
          up: sql<number>`sum(case when ${checks.status} <> 'DOWN' then 1 else 0 end)`,
          down: sql<number>`sum(case when ${checks.status} = 'DOWN' then 1 else 0 end)`,
          avgLatency: sql<number | null>`avg(${checks.latencyMs})`,
        })
        .from(checks)
        .where(and(eq(checks.targetId, targetId), gte(checks.checkedAt, sinceIso)))
        .get()

      return {
        total: row?.total ?? 0,
        up: row?.up ?? 0,
        down: row?.down ?? 0,
        avgLatencyMs: row?.avgLatency == null ? null : Math.round(row.avgLatency),
      }
    },

    deleteOlderThan(cutoffIso) {
      return (db.delete(checks).where(lt(checks.checkedAt, cutoffIso)).run() as unknown as Changes)
        .changes
    },
  }
}
