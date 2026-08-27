import { beforeEach, describe, expect, it } from 'bun:test'
import { messengerUnlinkCommand } from '../../../src/bot/commands/messenger-unlink.js'
import { openTestDb } from '../../../src/db/connection.js'
import { makeMessengerRepo } from '../../../src/db/messenger.repo.js'
import { applyMigrations } from '../../../src/db/migrate.js'
import { makeTestContext, TEST_NOW } from '../../helpers/context.js'
import type { InteractionLike } from '../../../src/bot/types.js'

describe('messengerUnlinkCommand', () => {
  let messenger: ReturnType<typeof makeMessengerRepo>
  let context: ReturnType<typeof makeTestContext>

  beforeEach(async () => {
    const { db } = openTestDb()
    await applyMigrations(db)
    messenger = makeMessengerRepo(db)
    context = makeTestContext(db)
    context.messenger = messenger
  })

  it('unlink khi chưa link thì báo', async () => {
    let replied = ''
    const interaction: InteractionLike = {
      commandName: 'messenger-unlink',
      user: { id: 'd-user1' },
      options: {
        getString: () => null,
        getInteger: () => null,
        getChannel: () => null,
      },
      async reply(payload) {
        replied = payload.content ?? ''
      },
      async followUp() {},
      async deferReply() {},
      async editReply() {},
    }

    await messengerUnlinkCommand.execute(context, interaction)

    expect(replied).toMatch(/chưa liên kết/i)
  })

  it('unlink khi đã link thì xoá link', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-user1', isAdmin: false, atIso: TEST_NOW })

    let replied = ''
    const interaction: InteractionLike = {
      commandName: 'messenger-unlink',
      user: { id: 'd-user1' },
      options: {
        getString: () => null,
        getInteger: () => null,
        getChannel: () => null,
      },
      async reply(payload) {
        replied = payload.content ?? ''
      },
      async followUp() {},
      async deferReply() {},
      async editReply() {},
    }

    expect(messenger.findIdentity('p1')).not.toBeNull()

    await messengerUnlinkCommand.execute(context, interaction)

    expect(replied).toMatch(/huỷ liên kết/i)
    expect(messenger.findIdentity('p1')).toBeNull()
  })

  it('unlink một user không ảnh hưởng đến link của user khác', async () => {
    messenger.link({ psid: 'p1', discordUserId: 'd-user1', isAdmin: false, atIso: TEST_NOW })
    messenger.link({ psid: 'p2', discordUserId: 'd-user2', isAdmin: false, atIso: TEST_NOW })

    const interaction: InteractionLike = {
      commandName: 'messenger-unlink',
      user: { id: 'd-user1' },
      options: {
        getString: () => null,
        getInteger: () => null,
        getChannel: () => null,
      },
      async reply() {},
      async followUp() {},
      async deferReply() {},
      async editReply() {},
    }

    await messengerUnlinkCommand.execute(context, interaction)

    expect(messenger.findIdentity('p1')).toBeNull()
    expect(messenger.findIdentity('p2')).not.toBeNull()
  })
})
