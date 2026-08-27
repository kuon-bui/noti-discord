import { beforeEach, describe, expect, it } from 'bun:test'
import {
  destAddCommand,
  destListCommand,
  destRemoveCommand,
} from '../../../src/bot/commands/dest.js'
import type { CommandContext, InteractionLike, InteractionReply } from '../../../src/bot/types.js'
import { openTestDb } from '../../../src/db/connection.js'
import { applyMigrations } from '../../../src/db/migrate.js'
import { makeTestContext, TEST_NOW } from '../../helpers/context.js'

type Options = { provider?: string; address?: string; name?: string }

function interaction(commandName: string, options: Options) {
  const replies: InteractionReply[] = []
  const value: InteractionLike = {
    commandName,
    user: { id: 'admin-1' },
    options: {
      getString: (name) => (options as Record<string, string | undefined>)[name] ?? null,
      getInteger: () => null,
      getChannel: () => null,
    },
    reply: async (p) => {
      replies.push(p)
      return {}
    },
    followUp: async (p) => {
      replies.push(p)
      return {}
    },
    deferReply: async () => ({}),
    editReply: async (p) => {
      replies.push(p)
      return {}
    },
  }
  return { interaction: value, replies }
}

let context: CommandContext

beforeEach(async () => {
  const { db } = openTestDb()
  await applyMigrations(db)
  context = makeTestContext(db)
})

function createTarget(name: string) {
  return context.targets.create({
    name,
    url: 'https://a.test',
    intervalSeconds: 60,
    timeoutMs: 10_000,
    createdBy: 'u1',
    createdAt: TEST_NOW,
  })
}

describe('/dest-add', () => {
  it('khai báo quyền đúng', () => {
    expect(destAddCommand.adminOnly).toBe(true)
    expect(destRemoveCommand.adminOnly).toBe(true)
    expect(destListCommand.adminOnly).toBe(false)
  })

  it('không truyền name thì tạo destination toàn cục', async () => {
    const { interaction: v, replies } = interaction('dest-add', {
      provider: 'messenger',
      address: 'psid-1',
    })
    await destAddCommand.execute(context, v)

    expect(context.destinations.listGlobal().map((r) => r.address)).toEqual(['psid-1'])
    expect(replies[0]?.content).toContain('toàn cục')
  })

  it('truyền name thì gắn vào target đó', async () => {
    const web = createTarget('web')
    const { interaction: v } = interaction('dest-add', {
      provider: 'discord',
      address: 'chan-1',
      name: 'web',
    })
    await destAddCommand.execute(context, v)

    expect(context.destinations.listForTarget(web.id)).toHaveLength(1)
    expect(context.destinations.listGlobal()).toEqual([])
  })

  it('provider lạ thì báo lỗi, không tạo gì', async () => {
    const { interaction: v, replies } = interaction('dest-add', {
      provider: 'zalo',
      address: 'x',
    })
    await destAddCommand.execute(context, v)
    expect(context.destinations.listGlobal()).toEqual([])
    expect(replies[0]?.content).toMatch(/provider/i)
  })

  it('target không tồn tại thì báo lỗi', async () => {
    const { interaction: v, replies } = interaction('dest-add', {
      provider: 'discord',
      address: 'chan-1',
      name: 'không-có',
    })
    await destAddCommand.execute(context, v)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })

  it('thêm trùng thì báo đã tồn tại, không tạo row thứ hai', async () => {
    const first = interaction('dest-add', { provider: 'messenger', address: 'psid-1' })
    await destAddCommand.execute(context, first.interaction)
    const second = interaction('dest-add', { provider: 'messenger', address: 'psid-1' })
    await destAddCommand.execute(context, second.interaction)

    expect(context.destinations.listGlobal()).toHaveLength(1)
    expect(second.replies[0]?.content).toMatch(/đã tồn tại/i)
  })
})

describe('/dest-remove', () => {
  it('xoá được, và báo rõ khi không có gì để xoá', async () => {
    const add = interaction('dest-add', { provider: 'messenger', address: 'psid-1' })
    await destAddCommand.execute(context, add.interaction)

    const hit = interaction('dest-remove', { provider: 'messenger', address: 'psid-1' })
    await destRemoveCommand.execute(context, hit.interaction)
    expect(context.destinations.listGlobal()).toEqual([])

    const miss = interaction('dest-remove', { provider: 'messenger', address: 'psid-1' })
    await destRemoveCommand.execute(context, miss.interaction)
    expect(miss.replies[0]?.content).toMatch(/không tìm thấy/i)
  })
})

describe('/dest-list', () => {
  it('chưa có gì thì nói rõ', async () => {
    const { interaction: v, replies } = interaction('dest-list', {})
    await destListCommand.execute(context, v)
    expect(replies[0]?.content).toMatch(/chưa có/i)
  })

  it('liệt kê destination toàn cục khi không truyền name', async () => {
    const add = interaction('dest-add', { provider: 'messenger', address: 'psid-1' })
    await destAddCommand.execute(context, add.interaction)

    const { interaction: v, replies } = interaction('dest-list', {})
    await destListCommand.execute(context, v)
    expect(replies[0]?.content).toContain('psid-1')
  })
})
