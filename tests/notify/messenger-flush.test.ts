import { beforeEach, describe, expect, it } from 'bun:test'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeOutboxRepo, type OutboxRepo } from '../../src/db/outbox.repo.js'
import { makeTargetsRepo, type TargetsRepo } from '../../src/db/targets.repo.js'
import type { MessengerClient } from '../../src/notify/messenger-client.js'
import { makeMessengerFlusher } from '../../src/notify/messenger-flush.js'
import { silentLogger } from '../../src/shared/logger.js'
import type { AlertMessage } from '../../src/shared/types.js'

const NOW = new Date('2026-08-26T12:00:00.000Z')

function msg(title: string, targetName = 'api'): AlertMessage {
  return {
    kind: 'down',
    targetName,
    title,
    description: 'd',
    color: 1,
    fields: [],
    timestampIso: NOW.toISOString(),
  }
}

function fakeClient() {
  const sent: string[] = []
  const client: MessengerClient = {
    async sendText(_psid, text) {
      sent.push(text)
    },
    async sendTyping() {},
  }
  return { client, sent }
}

describe('makeMessengerFlusher', () => {
  let outbox: OutboxRepo
  let targets: TargetsRepo

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    outbox = makeOutboxRepo(db)
    targets = makeTargetsRepo(db)
  })

  function flusher(client: MessengerClient, maxAgeHours = 48) {
    return makeMessengerFlusher({
      client,
      outbox,
      targets,
      clock: () => NOW,
      logger: silentLogger,
      maxAgeHours,
    })
  }

  function enqueue(title: string, createdAt = '2026-08-26T11:00:00.000Z', targetName = 'api') {
    outbox.enqueue({
      provider: 'messenger',
      address: 'psid-1',
      targetName,
      message: msg(title, targetName),
      createdAt,
    })
  }

  it('outbox rỗng thì không gửi gì', async () => {
    const { client, sent } = fakeClient()
    await flusher(client).flush('psid-1')
    expect(sent).toEqual([])
  })

  it('từ 3 entry trở xuống thì gửi từng cái theo thứ tự thời gian, rồi xoá', async () => {
    enqueue('thứ hai', '2026-08-26T11:30:00.000Z')
    enqueue('thứ nhất', '2026-08-26T11:00:00.000Z')
    const { client, sent } = fakeClient()

    await flusher(client).flush('psid-1')

    expect(sent).toHaveLength(2)
    expect(sent[0]).toContain('thứ nhất')
    expect(sent[1]).toContain('thứ hai')
    expect(outbox.listFor('messenger', 'psid-1')).toEqual([])
  })

  it('quá 3 entry thì gộp thành một tin kèm trạng thái hiện tại', async () => {
    targets.create({
      name: 'api',
      url: 'https://a.test',
      intervalSeconds: 60,
      timeoutMs: 10_000,
      createdBy: 'u1',
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    const api = targets.findByName('api')!
    targets.updateStatus(api.id, 'UP', NOW.toISOString())

    for (let i = 0; i < 7; i += 1) enqueue(`alert ${i}`)
    const { client, sent } = fakeClient()

    await flusher(client).flush('psid-1')

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('Đã bỏ lỡ 7 thông báo')
    expect(sent[0]).toContain('Trạng thái hiện tại')
    expect(sent[0]).toContain('api — UP')
    expect(sent[0]).not.toContain('alert 0')
    expect(outbox.listFor('messenger', 'psid-1')).toEqual([])
  })

  it('gộp mà target đã bị xoá thì chỉ báo số lượng', async () => {
    for (let i = 0; i < 5; i += 1) enqueue(`alert ${i}`, '2026-08-26T11:00:00.000Z', 'đã-xoá')
    const { client, sent } = fakeClient()

    await flusher(client).flush('psid-1')

    expect(sent[0]).toContain('Đã bỏ lỡ 5 thông báo')
    expect(sent[0]).not.toContain('Trạng thái hiện tại')
  })

  it('entry quá hạn bị bỏ, không gửi', async () => {
    enqueue('quá cũ', '2026-08-20T00:00:00.000Z')
    enqueue('còn hạn', '2026-08-26T11:00:00.000Z')
    const { client, sent } = fakeClient()

    await flusher(client, 48).flush('psid-1')

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('còn hạn')
  })

  it('gửi thất bại thì entry còn lại trong outbox để lần sau thử lại', async () => {
    enqueue('a')
    const client: MessengerClient = {
      async sendText() {
        throw new Error('mạng lỗi')
      },
      async sendTyping() {},
    }

    await expect(flusher(client).flush('psid-1')).rejects.toThrow(/mạng lỗi/)
    expect(outbox.listFor('messenger', 'psid-1')).toHaveLength(1)
  })
})
