import { beforeEach, describe, expect, it } from 'bun:test'
import { openTestDb } from '../../src/db/connection.js'
import { makeMessengerRepo, type MessengerRepo } from '../../src/db/messenger.repo.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeOutboxRepo, type OutboxRepo } from '../../src/db/outbox.repo.js'
import { MessengerApiError, type MessengerClient } from '../../src/notify/messenger-client.js'
import { makeMessengerNotifier } from '../../src/notify/messenger-notifier.js'
import type { Notifier } from '../../src/notify/notifier.js'
import { silentLogger } from '../../src/shared/logger.js'
import type { AlertMessage } from '../../src/shared/types.js'

const NOW = new Date('2026-08-26T12:00:00.000Z')

const MSG: AlertMessage = {
  kind: 'down',
  targetName: 'api',
  title: '🔴 api đang DOWN',
  description: 'd',
  color: 1,
  fields: [],
  timestampIso: NOW.toISOString(),
}

function fakeClient(behaviour: 'ok' | MessengerApiError = 'ok') {
  const sent: Array<{ psid: string; text: string }> = []
  const client: MessengerClient = {
    async sendText(psid, text) {
      sent.push({ psid, text })
      if (behaviour !== 'ok') throw behaviour
    },
    async sendTyping() {},
  }
  return { client, sent }
}

describe('makeMessengerNotifier', () => {
  let messenger: MessengerRepo
  let outbox: OutboxRepo

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    messenger = makeMessengerRepo(db)
    outbox = makeOutboxRepo(db)
  })

  function notifier(client: MessengerClient): Notifier {
    return makeMessengerNotifier({
      client,
      messenger,
      outbox,
      clock: () => NOW,
      logger: silentLogger,
    })
  }

  it('khai báo provider messenger', () => {
    expect(notifier(fakeClient().client).provider).toBe('messenger')
  })

  it('cửa sổ mở thì gửi thật, không vào outbox', async () => {
    messenger.link({
      psid: 'psid-1',
      discordUserId: 'd1',
      isAdmin: true,
      atIso: '2026-08-26T11:00:00.000Z',
    })
    const { client, sent } = fakeClient()

    await notifier(client).send(MSG, 'psid-1')

    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toContain('api đang DOWN')
    expect(outbox.listFor('messenger', 'psid-1')).toEqual([])
  })

  it('cửa sổ đóng thì vào outbox VÀ KHÔNG gọi API', async () => {
    messenger.link({
      psid: 'psid-1',
      discordUserId: 'd1',
      isAdmin: true,
      atIso: '2026-08-24T00:00:00.000Z', // hơn 2 ngày trước
    })
    const { client, sent } = fakeClient()

    await notifier(client).send(MSG, 'psid-1')

    expect(sent).toEqual([])
    const queued = outbox.listFor('messenger', 'psid-1')
    expect(queued).toHaveLength(1)
    expect(queued[0]?.targetName).toBe('api')
    expect(queued[0]?.message.title).toBe(MSG.title)
  })

  it('biên là 23h, không phải 24h', async () => {
    // 23h30m trước — trong cửa sổ 24h của Meta nhưng ngoài biên an toàn của ta.
    messenger.link({
      psid: 'psid-1',
      discordUserId: 'd1',
      isAdmin: true,
      atIso: '2026-08-25T12:30:00.000Z',
    })
    const { client, sent } = fakeClient()

    await notifier(client).send(MSG, 'psid-1')

    expect(sent).toEqual([])
    expect(outbox.listFor('messenger', 'psid-1')).toHaveLength(1)
  })

  it('PSID chưa link thì vào outbox, không gọi API', async () => {
    const { client, sent } = fakeClient()
    await notifier(client).send(MSG, 'psid-lạ')

    expect(sent).toEqual([])
    expect(outbox.listFor('messenger', 'psid-lạ')).toHaveLength(1)
  })

  it('Meta trả lỗi cửa sổ thì vào outbox kèm lastError', async () => {
    messenger.link({
      psid: 'psid-1',
      discordUserId: 'd1',
      isAdmin: true,
      atIso: '2026-08-26T11:00:00.000Z',
    })
    const { client } = fakeClient(new MessengerApiError('outside window', 10))

    await expect(notifier(client).send(MSG, 'psid-1')).resolves.toBeUndefined()
    expect(outbox.listFor('messenger', 'psid-1')).toHaveLength(1)
  })

  it('lỗi KHÁC cửa sổ thì throw ra cho dispatcher, không vào outbox', async () => {
    messenger.link({
      psid: 'psid-1',
      discordUserId: 'd1',
      isAdmin: true,
      atIso: '2026-08-26T11:00:00.000Z',
    })
    const { client } = fakeClient(new MessengerApiError('token sai', 190))

    await expect(notifier(client).send(MSG, 'psid-1')).rejects.toThrow(/token sai/)
    expect(outbox.listFor('messenger', 'psid-1')).toEqual([])
  })

  it('tin dài bị cắt thành nhiều lần gửi', async () => {
    messenger.link({
      psid: 'psid-1',
      discordUserId: 'd1',
      isAdmin: true,
      atIso: '2026-08-26T11:00:00.000Z',
    })
    const { client, sent } = fakeClient()

    await notifier(client).send({ ...MSG, description: 'x'.repeat(5_000) }, 'psid-1')

    expect(sent.length).toBeGreaterThan(1)
  })
})
