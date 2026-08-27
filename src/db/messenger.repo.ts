import type { Changes } from 'bun:sqlite'
import { and, asc, eq, isNull, lt } from 'drizzle-orm'
import type { Db } from './connection.js'
import { messengerIdentities, messengerLinkCodes, messengerSeenMids } from './schema.js'

export type MessengerIdentity = {
  psid: string
  discordUserId: string | null
  isAdmin: boolean
  lastInboundAt: string | null
}

export type LinkCodeInput = {
  code: string
  discordUserId: string
  expiresAtIso: string
}

export type LinkInput = {
  psid: string
  discordUserId: string
  isAdmin: boolean
  atIso: string
}

export type MessengerRepo = {
  findIdentity(psid: string): MessengerIdentity | null
  adminPsids(): string[]
  /** Chỉ update. PSID chưa link thì không có hàng nào để chạm. */
  touchInbound(psid: string, atIso: string): void
  link(input: LinkInput): void
  unlink(psid: string): boolean
  createLinkCode(input: LinkCodeInput): void
  consumeLinkCode(code: string, nowIso: string): { discordUserId: string } | null
  /** false nếu mid đã xử lý trước đó. */
  markMidSeen(mid: string, atIso: string): boolean
  deleteMidsOlderThan(cutoffIso: string): number
}

type IdentityRow = typeof messengerIdentities.$inferSelect

function toIdentity(row: IdentityRow): MessengerIdentity {
  return {
    psid: row.psid,
    discordUserId: row.discordUserId,
    isAdmin: row.isAdmin === 1,
    lastInboundAt: row.lastInboundAt,
  }
}

export function makeMessengerRepo(db: Db): MessengerRepo {
  return {
    findIdentity(psid) {
      const row = db
        .select()
        .from(messengerIdentities)
        .where(eq(messengerIdentities.psid, psid))
        .get()
      return row ? toIdentity(row) : null
    },

    adminPsids() {
      return db
        .select()
        .from(messengerIdentities)
        .where(eq(messengerIdentities.isAdmin, 1))
        .orderBy(asc(messengerIdentities.psid))
        .all()
        .map((row) => row.psid)
    },

    touchInbound(psid, atIso) {
      db.update(messengerIdentities)
        .set({ lastInboundAt: atIso })
        .where(eq(messengerIdentities.psid, psid))
        .run()
    },

    link(input) {
      db.insert(messengerIdentities)
        .values({
          psid: input.psid,
          discordUserId: input.discordUserId,
          isAdmin: input.isAdmin ? 1 : 0,
          lastInboundAt: input.atIso,
          linkedAt: input.atIso,
        })
        .onConflictDoUpdate({
          target: messengerIdentities.psid,
          set: {
            discordUserId: input.discordUserId,
            isAdmin: input.isAdmin ? 1 : 0,
            lastInboundAt: input.atIso,
            linkedAt: input.atIso,
          },
        })
        .run()
    },

    unlink(psid) {
      const result = db
        .delete(messengerIdentities)
        .where(eq(messengerIdentities.psid, psid))
        .run() as unknown as Changes
      return result.changes > 0
    },

    createLinkCode(input) {
      db.insert(messengerLinkCodes)
        .values({
          code: input.code,
          discordUserId: input.discordUserId,
          expiresAt: input.expiresAtIso,
        })
        .run()
    },

    consumeLinkCode(code, nowIso) {
      const row = db
        .select()
        .from(messengerLinkCodes)
        .where(and(eq(messengerLinkCodes.code, code), isNull(messengerLinkCodes.usedAt)))
        .get()

      if (!row) return null
      // So sánh chuỗi ISO UTC là so sánh thời gian đúng vì cùng định dạng, cùng độ dài.
      if (row.expiresAt <= nowIso) return null

      db.update(messengerLinkCodes)
        .set({ usedAt: nowIso })
        .where(eq(messengerLinkCodes.code, code))
        .run()

      return { discordUserId: row.discordUserId }
    },

    markMidSeen(mid, atIso) {
      const existing = db
        .select()
        .from(messengerSeenMids)
        .where(eq(messengerSeenMids.mid, mid))
        .get()
      if (existing) return false

      db.insert(messengerSeenMids).values({ mid, seenAt: atIso }).run()
      return true
    },

    deleteMidsOlderThan(cutoffIso) {
      const result = db
        .delete(messengerSeenMids)
        .where(lt(messengerSeenMids.seenAt, cutoffIso))
        .run() as unknown as Changes
      return result.changes
    },
  }
}
