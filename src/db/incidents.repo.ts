import { and, desc, eq, gte, isNull, or } from 'drizzle-orm'
import type { Incident } from '../shared/types.js'
import type { Db } from './connection.js'
import { incidents } from './schema.js'

type Row = typeof incidents.$inferSelect

function toIncident(row: Row): Incident {
  return {
    id: row.id,
    targetId: row.targetId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    reason: row.reason,
  }
}

export type IncidentsRepo = {
  open(targetId: number, reason: string | null, atIso: string): Incident
  close(targetId: number, atIso: string): Incident | null
  findOpen(targetId: number): Incident | null
  listRecent(targetId: number, limit: number): Incident[]
  listOverlapping(targetId: number, sinceIso: string): Incident[]
}

export function makeIncidentsRepo(db: Db): IncidentsRepo {
  const repo: IncidentsRepo = {
    open(targetId, reason, atIso) {
      const existing = repo.findOpen(targetId)
      if (existing) return existing
      const row = db
        .insert(incidents)
        .values({ targetId, startedAt: atIso, endedAt: null, reason })
        .returning()
        .get()
      return toIncident(row)
    },

    close(targetId, atIso) {
      const open = repo.findOpen(targetId)
      if (!open) return null
      const row = db
        .update(incidents)
        .set({ endedAt: atIso })
        .where(eq(incidents.id, open.id))
        .returning()
        .get()
      return toIncident(row)
    },

    findOpen(targetId) {
      const row = db
        .select()
        .from(incidents)
        .where(and(eq(incidents.targetId, targetId), isNull(incidents.endedAt)))
        .orderBy(desc(incidents.startedAt))
        .get()
      return row ? toIncident(row) : null
    },

    listRecent(targetId, limit) {
      return db
        .select()
        .from(incidents)
        .where(eq(incidents.targetId, targetId))
        .orderBy(desc(incidents.startedAt), desc(incidents.id))
        .limit(limit)
        .all()
        .map(toIncident)
    },

    listOverlapping(targetId, sinceIso) {
      return db
        .select()
        .from(incidents)
        .where(
          and(
            eq(incidents.targetId, targetId),
            or(isNull(incidents.endedAt), gte(incidents.endedAt, sinceIso)),
          ),
        )
        .orderBy(desc(incidents.startedAt))
        .all()
        .map(toIncident)
    },
  }
  return repo
}
