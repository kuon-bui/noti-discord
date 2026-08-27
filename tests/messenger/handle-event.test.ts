import { beforeEach, describe, expect, it } from 'bun:test'
import { allCommands } from '../../src/bot/commands/index.js'
import { makeRouter } from '../../src/bot/router.js'
import type { CommandContext } from '../../src/bot/types.js'
import { openTestDb } from '../../src/db/connection.js'
import { makeMessengerRepo, type MessengerRepo } from '../../src/db/messenger.repo.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeMessengerEventHandler } from '../../src/messenger/handle-event.js'
import type { MessengerClient } from '../../src/notify/messenger-client.js'
import { silentLogger } from '../../src/shared/logger.js'
import { makeTestContext, TEST_NOW } from '../helpers/context.js'

const NOW = new Date('2026-08-26T12:00:00.000Z')

function pageEvent(psid: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    object: 'page',
    entry: [
      {
        messaging: [{ sender: { id: psid }, message: { mid: `m-${text}`, text, ...extra } }],
      },
    ],
  }
}

describe('makeMessengerEventHandler', () => {
  let context: CommandContext
  let messenger: MessengerRepo
  let sent: string[]
  let flushed: string[]
  let client: MessengerClient

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    context = makeTestContext(db)
    messenger = makeMessengerRepo(db)
    sent = []
    flushed = []
    client = {
      async sendText(_psid, text) {
        sent.push(text)
      },
      async sendTyping() {},
    }
  })

  function handler(adminUserIds: readonly string[] = ['d-admin']) {
    const commands = allCommands()
    return makeMessengerEventHandler({
      messenger,
      destinations: context.destinations,
      flusher: {
        async flush(psid) {
          flushed.push(psid)
        },
      },
      client,
      router: makeRouter({
        commands,
        ctx: context,
        isAdmin: (psid) => messenger.findIdentity(psid)?.isAdmin === true,
        logger: silentLogger,
      }),
      commands,
      adminUserIds,
      clock: () => NOW,
      logger: silentLogger,
    })
  }

  it('bỏ qua payload không phải object page', async () => {
    await handler().handle({ object: 'instagram', entry: [] })
    expect(sent).toEqual([])
  })

  it('bỏ qua tin echo do chính Page gửi', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-admin', isAdmin: true, atIso: TEST_NOW })
    await handler().handle(pageEvent('p1', 'status', { is_echo: true }))
    expect(sent).toEqual([])
  })

  it('dedupe theo mid — event lặp không chạy lệnh lần hai', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-admin', isAdmin: true, atIso: TEST_NOW })
    const h = handler()
    await h.handle(pageEvent('p1', 'add', {}))
    const first = sent.length
    await h.handle(pageEvent('p1', 'add', {}))
    expect(sent.length).toBe(first)
  })

  it('cập nhật last_inbound_at rồi flush outbox', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-admin', isAdmin: true, atIso: TEST_NOW })
    await handler().handle(pageEvent('p1', 'status'))

    expect(messenger.findIdentity('p1')?.lastInboundAt).toBe(NOW.toISOString())
    expect(flushed).toEqual(['p1'])
  })

  it('PSID chưa link thì được hướng dẫn, KHÔNG chạy lệnh nào', async () => {
    await handler().handle(pageEvent('p-lạ', 'add api https://x.dev'))

    expect(context.targets.findAll()).toEqual([])
    expect(sent.join('\n')).toMatch(/messenger-link/)
  })

  it('nhắn link code thì liên kết, cấp quyền theo Discord id, và tạo destination', async () => {
    messenger.createLinkCode({
      code: 'ABC12345',
      discordUserId: 'd-admin',
      expiresAtIso: '2026-08-26T12:10:00.000Z',
    })

    await handler().handle(pageEvent('p1', 'ABC12345'))

    expect(messenger.findIdentity('p1')).toMatchObject({
      discordUserId: 'd-admin',
      isAdmin: true,
    })
    expect(context.destinations.listGlobal()).toMatchObject([
      { provider: 'messenger', address: 'p1' },
    ])
    expect(sent.join('\n')).toMatch(/liên kết/i)
  })

  it('link code của người không phải admin thì không được quyền admin', async () => {
    messenger.createLinkCode({
      code: 'ABC12345',
      discordUserId: 'd-thường',
      expiresAtIso: '2026-08-26T12:10:00.000Z',
    })

    await handler().handle(pageEvent('p1', 'abc12345'))
    expect(messenger.findIdentity('p1')?.isAdmin).toBe(false)
  })

  it('lệnh admin từ PSID không phải admin bị chặn', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-thường', isAdmin: false, atIso: TEST_NOW })
    await handler().handle(pageEvent('p1', 'add api https://x.dev'))

    expect(context.targets.findAll()).toEqual([])
    expect(sent.join('\n')).toMatch(/không có quyền/i)
  })

  it('lệnh lạ thì trả danh sách lệnh theo quyền người gửi', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-thường', isAdmin: false, atIso: TEST_NOW })
    await handler().handle(pageEvent('p1', 'khongtontai'))

    const text = sent.join('\n')
    expect(text).toContain('status')
    expect(text).not.toContain('remove')
  })

  it('tham số sai thì báo lỗi cụ thể chứ không trả help', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-admin', isAdmin: true, atIso: TEST_NOW })
    await handler().handle(pageEvent('p1', 'pause api abc'))
    expect(sent.join('\n')).toMatch(/số nguyên/)
  })

  it('lệnh chạy thật: add rồi status', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-admin', isAdmin: true, atIso: TEST_NOW })
    const h = handler()
    await h.handle(pageEvent('p1', 'add api https://x.dev'))
    expect(context.targets.findByName('api')).not.toBeNull()

    sent.length = 0
    await h.handle(pageEvent('p1', 'status'))
    expect(sent.join('\n')).toContain('api')
  })

  it('tin không có text (sticker, ảnh) thì bỏ qua', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-admin', isAdmin: true, atIso: TEST_NOW })
    await handler().handle({
      object: 'page',
      entry: [{ messaging: [{ sender: { id: 'p1' }, message: { mid: 'm1' } }] }],
    })
    expect(sent).toEqual([])
  })

  it('một event lỗi không chặn event còn lại trong cùng batch', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-admin', isAdmin: true, atIso: TEST_NOW })
    await handler().handle({
      object: 'page',
      entry: [
        { messaging: [{ sender: {}, message: { mid: 'm-thiếu-psid', text: 'status' } }] },
        { messaging: [{ sender: { id: 'p1' }, message: { mid: 'm-ok', text: 'status' } }] },
      ],
    })
    expect(sent.length).toBeGreaterThan(0)
  })
})
