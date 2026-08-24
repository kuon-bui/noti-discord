import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import type { Status, Target } from '../shared/types.js'
import type { Db } from './connection.js'
import { targets } from './schema.js'

export type CreateTargetInput = {
  name: string
  url: string
  method?: string
  expectedStatus?: string
  latencyThresholdMs?: number | null
  intervalSeconds: number
  timeoutMs: number
  alertChannelId?: string | null
  createdBy: string
  createdAt: string
}

type Row = typeof targets.$inferSelect

function toTarget(row: Row): Target {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    method: row.method,
    expectedStatus: row.expectedStatus,
    latencyThresholdMs: row.latencyThresholdMs,
    intervalSeconds: row.intervalSeconds,
    timeoutMs: row.timeoutMs,
    alertChannelId: row.alertChannelId,
    pausedUntil: row.pausedUntil,
    currentStatus: row.currentStatus as Status,
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  }
}

export type TargetsRepo = {
  create(input: CreateTargetInput): Target
  findByName(name: string): Target | null
  findById(id: number): Target | null
  findAll(): Target[]
  findDue(nowIso: string): Target[]
  updateStatus(id: number, status: Status, checkedAtIso: string): void
  setPause(id: number, pausedUntilIso: string | null): void
  remove(name: string): boolean
}

export function makeTargetsRepo(db: Db): TargetsRepo {
  return {
    create(input) {
      const row = db
        .insert(targets)
        .values({
          name: input.name,
          url: input.url,
          method: input.method ?? 'GET',
          expectedStatus: input.expectedStatus ?? '200-299',
          latencyThresholdMs: input.latencyThresholdMs ?? null,
          intervalSeconds: input.intervalSeconds,
          timeoutMs: input.timeoutMs,
          alertChannelId: input.alertChannelId ?? null,
          createdAt: input.createdAt,
          createdBy: input.createdBy,
        })
        .returning()
        .get()
      return toTarget(row)
    },

    findByName(name) {
      const row = db.select().from(targets).where(eq(targets.name, name)).get()
      return row ? toTarget(row) : null
    },

    findById(id) {
      const row = db.select().from(targets).where(eq(targets.id, id)).get()
      return row ? toTarget(row) : null
    },

    findAll() {
      return db.select().from(targets).orderBy(asc(targets.name)).all().map(toTarget)
    },

    findDue(nowIso) {
      // strftime('%s', ...) returns TEXT in SQLite. Cast both sides so the
      // comparison is numeric rather than SQLite's cross-storage-class order.
      const dueByInterval = or(
        isNull(targets.lastCheckedAt),
        sql`CAST(strftime('%s', ${targets.lastCheckedAt}) AS INTEGER) + ${targets.intervalSeconds} <= CAST(strftime('%s', ${nowIso}) AS INTEGER)`,
      )
      const notPaused = or(
        isNull(targets.pausedUntil),
        sql`CAST(strftime('%s', ${targets.pausedUntil}) AS INTEGER) <= CAST(strftime('%s', ${nowIso}) AS INTEGER)`,
      )
      return db
        .select()
        .from(targets)
        .where(and(dueByInterval, notPaused))
        .orderBy(asc(targets.name))
        .all()
        .map(toTarget)
    },

    updateStatus(id, status, checkedAtIso) {
      db.update(targets)
        .set({ currentStatus: status, lastCheckedAt: checkedAtIso })
        .where(eq(targets.id, id))
        .run()
    },

    setPause(id, pausedUntilIso) {
      db.update(targets).set({ pausedUntil: pausedUntilIso }).where(eq(targets.id, id)).run()
    },

    remove(name) {
      const result = db.delete(targets).where(eq(targets.name, name)).run()
      return result.changes > 0
    },
  }
}
