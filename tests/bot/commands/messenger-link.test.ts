import { beforeEach, describe, expect, it } from 'bun:test'
import { messengerLinkCommand } from '../../../src/bot/commands/messenger-link.js'
import { openTestDb } from '../../../src/db/connection.js'
import { makeMessengerRepo } from '../../../src/db/messenger.repo.js'
import { applyMigrations } from '../../../src/db/migrate.js'
import { makeTestContext, TEST_NOW } from '../../helpers/context.js'
import type { InteractionLike } from '../../../src/bot/types.js'

const NOW = new Date('2026-08-26T12:00:00.000Z')

describe('messengerLinkCommand', () => {
  let messenger: ReturnType<typeof makeMessengerRepo>
  let context: ReturnType<typeof makeTestContext>

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    messenger = makeMessengerRepo(db)
    context = makeTestContext(db)
    context.clock = () => NOW
    context.messenger = messenger
  })

  it('tạo link code 8 ký tự và trả cho user', async () => {
    const codes: string[] = []
    const interaction: InteractionLike = {
      commandName: 'messenger-link',
      user: { id: 'd-user1' },
      options: {
        getString: () => null,
        getInteger: () => null,
        getChannel: () => null,
      },
      async reply(payload) {
        const text = payload.content ?? ''
        const match = text.match(/`([A-F0-9]+)`/)
        if (match) codes.push(match[1])
      },
      async followUp() {},
      async deferReply() {},
      async editReply() {},
    }

    await messengerLinkCommand.execute(context, interaction)

    expect(codes).toHaveLength(1)
    expect(codes[0]).toMatch(/^[A-F0-9]{8}$/)
  })

  it('code có hiệu lực 10 phút', async () => {
    let capturedCode = ''
    let capturedText = ''
    const interaction: InteractionLike = {
      commandName: 'messenger-link',
      user: { id: 'd-user1' },
      options: {
        getString: () => null,
        getInteger: () => null,
        getChannel: () => null,
      },
      async reply(payload) {
        capturedText = payload.content ?? ''
        const match = capturedText.match(/`([A-F0-9]+)`/)
        if (match) capturedCode = match[1]
      },
      async followUp() {},
      async deferReply() {},
      async editReply() {},
    }

    await messengerLinkCommand.execute(context, interaction)

    expect(capturedText).toContain('10 phút')

    const code = messenger.consumeLinkCode(capturedCode, NOW.toISOString())
    expect(code).toEqual({ discordUserId: 'd-user1' })

    const expired = messenger.consumeLinkCode(
      capturedCode,
      new Date(NOW.getTime() + 11 * 60 * 1_000).toISOString(),
    )
    expect(expired).toBeNull()
  })

  it('tạo nhiều code thì mỗi cái khác nhau', async () => {
    const codes: string[] = []

    for (let i = 0; i < 3; i++) {
      const interaction: InteractionLike = {
        commandName: 'messenger-link',
        user: { id: `d-user${i}` },
        options: {
          getString: () => null,
          getInteger: () => null,
          getChannel: () => null,
        },
        async reply(payload) {
          const text = payload.content ?? ''
          const match = text.match(/`([A-F0-9]+)`/)
          if (match) codes.push(match[1])
        },
        async followUp() {},
        async deferReply() {},
        async editReply() {},
      }

      await messengerLinkCommand.execute(context, interaction)
    }

    const unique = new Set(codes)
    expect(unique.size).toBe(3)
  })

  it('code chỉ dùng được một lần', async () => {
    let capturedCode = ''
    const interaction: InteractionLike = {
      commandName: 'messenger-link',
      user: { id: 'd-user1' },
      options: {
        getString: () => null,
        getInteger: () => null,
        getChannel: () => null,
      },
      async reply(payload) {
        const text = payload.content ?? ''
        const match = text.match(/`([A-F0-9]+)`/)
        if (match) capturedCode = match[1]
      },
      async followUp() {},
      async deferReply() {},
      async editReply() {},
    }

    await messengerLinkCommand.execute(context, interaction)

    const first = messenger.consumeLinkCode(capturedCode, NOW.toISOString())
    const second = messenger.consumeLinkCode(capturedCode, NOW.toISOString())

    expect(first).not.toBeNull()
    expect(second).toBeNull()
  })
})
