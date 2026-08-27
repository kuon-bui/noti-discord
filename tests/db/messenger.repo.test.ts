import { beforeEach, describe, expect, it } from 'bun:test'
import { openTestDb } from '../../src/db/connection.js'
import { makeMessengerRepo, type MessengerRepo } from '../../src/db/messenger.repo.js'
import { applyMigrations } from '../../src/db/migrate.js'

const NOW = '2026-08-26T10:00:00.000Z'

describe('MessengerRepo', () => {
  let repo: MessengerRepo

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    repo = makeMessengerRepo(db)
  })

  describe('identity', () => {
    it('chưa link thì findIdentity trả null', () => {
      expect(repo.findIdentity('psid-1')).toBeNull()
    })

    it('link tạo identity với quyền và mốc inbound', () => {
      repo.link({ psid: 'psid-1', discordUserId: 'd1', isAdmin: true, atIso: NOW })
      expect(repo.findIdentity('psid-1')).toEqual({
        psid: 'psid-1',
        discordUserId: 'd1',
        isAdmin: true,
        lastInboundAt: NOW,
      })
    })

    it('link lại cùng PSID thì cập nhật, không nhân bản', () => {
      repo.link({ psid: 'psid-1', discordUserId: 'd1', isAdmin: false, atIso: NOW })
      repo.link({ psid: 'psid-1', discordUserId: 'd2', isAdmin: true, atIso: NOW })
      expect(repo.findIdentity('psid-1')?.discordUserId).toBe('d2')
      expect(repo.findIdentity('psid-1')?.isAdmin).toBe(true)
    })

    it('adminPsids chỉ trả identity có quyền admin', () => {
      repo.link({ psid: 'psid-admin', discordUserId: 'd1', isAdmin: true, atIso: NOW })
      repo.link({ psid: 'psid-thường', discordUserId: 'd2', isAdmin: false, atIso: NOW })
      expect(repo.adminPsids()).toEqual(['psid-admin'])
    })

    it('touchInbound cập nhật mốc, và không tạo identity cho PSID chưa link', () => {
      repo.link({ psid: 'psid-1', discordUserId: 'd1', isAdmin: true, atIso: NOW })
      repo.touchInbound('psid-1', '2026-08-26T11:00:00.000Z')
      expect(repo.findIdentity('psid-1')?.lastInboundAt).toBe('2026-08-26T11:00:00.000Z')

      repo.touchInbound('psid-lạ', NOW)
      expect(repo.findIdentity('psid-lạ')).toBeNull()
    })

    it('unlink trả false khi không có gì để xoá', () => {
      expect(repo.unlink('psid-1')).toBe(false)
      repo.link({ psid: 'psid-1', discordUserId: 'd1', isAdmin: true, atIso: NOW })
      expect(repo.unlink('psid-1')).toBe(true)
      expect(repo.findIdentity('psid-1')).toBeNull()
    })
  })

  describe('link code', () => {
    it('consume code hợp lệ trả discordUserId và chỉ dùng được một lần', () => {
      repo.createLinkCode({
        code: 'ABC12345',
        discordUserId: 'd1',
        expiresAtIso: '2026-08-26T10:10:00.000Z',
      })

      expect(repo.consumeLinkCode('ABC12345', NOW)).toEqual({ discordUserId: 'd1' })
      expect(repo.consumeLinkCode('ABC12345', NOW)).toBeNull()
    })

    it('code hết hạn thì không consume được', () => {
      repo.createLinkCode({
        code: 'OLD00000',
        discordUserId: 'd1',
        expiresAtIso: '2026-08-26T09:00:00.000Z',
      })
      expect(repo.consumeLinkCode('OLD00000', NOW)).toBeNull()
    })

    it('code không tồn tại thì trả null', () => {
      expect(repo.consumeLinkCode('KHONGCO1', NOW)).toBeNull()
    })
  })

  describe('seen mids', () => {
    it('mid mới trả true, mid lặp trả false', () => {
      expect(repo.markMidSeen('m1', NOW)).toBe(true)
      expect(repo.markMidSeen('m1', NOW)).toBe(false)
    })

    it('dọn được mid cũ', () => {
      repo.markMidSeen('m-cũ', '2026-08-20T00:00:00.000Z')
      repo.markMidSeen('m-mới', NOW)
      expect(repo.deleteMidsOlderThan('2026-08-25T00:00:00.000Z')).toBe(1)
      expect(repo.markMidSeen('m-cũ', NOW)).toBe(true)
      expect(repo.markMidSeen('m-mới', NOW)).toBe(false)
    })
  })
})
