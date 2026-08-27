import { beforeEach, describe, expect, it } from 'bun:test'
import { listCommand } from '../../../src/bot/commands/list.js'
import { removeCommand } from '../../../src/bot/commands/remove.js'
import type { CommandContext, InteractionLike, InteractionReply } from '../../../src/bot/types.js'
import { openTestDb } from '../../../src/db/connection.js'
import { applyMigrations } from '../../../src/db/migrate.js'
import { makeTestContext } from '../../helpers/context.js'

function interaction(commandName: string, name?: string) {
  const replies: InteractionReply[] = []
  const followUps: InteractionReply[] = []
  const value: InteractionLike = {
    commandName,
    user: { id: 'admin-1' },
    options: {
      getString: (optionName) => (optionName === 'name' ? name ?? null : null),
      getInteger: () => null,
      getChannel: () => null,
    },
    reply: async (payload) => {
      replies.push(payload)
      return {}
    },
    followUp: async (payload) => {
      followUps.push(payload)
      return {}
    },
    deferReply: async () => ({}),
    editReply: async (payload) => {
      replies.push(payload)
      return {}
    },
  }
  return { interaction: value, replies, followUps }
}

let context: CommandContext

beforeEach(async () => {
  const { db } = openTestDb()
  await applyMigrations(db)
  context = makeTestContext(db)
})

function seed(name: string) {
  return context.targets.create({
    name,
    url: `https://${name}.test`,
    intervalSeconds: 60,
    timeoutMs: 10_000,
    createdBy: 'u1',
    createdAt: '2026-08-24T00:00:00.000Z',
  })
}

describe('/remove', () => {
  it('là lệnh admin', () => {
    expect(removeCommand.adminOnly).toBe(true)
  })

  it('xoá được target đang có', async () => {
    seed('web')
    const { interaction: value, replies } = interaction('remove', 'web')
    await removeCommand.execute(context, value)
    expect(context.targets.findByName('web')).toBeNull()
    expect(replies[0]?.content).toContain('web')
  })

  it('target không tồn tại thì trả lời thân thiện', async () => {
    const { interaction: value, replies } = interaction('remove', 'không-có')
    await removeCommand.execute(context, value)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })

  it('thiếu name thì trả lời lỗi', async () => {
    const { interaction: value, replies } = interaction('remove')
    await removeCommand.execute(context, value)
    expect(replies[0]?.content).toMatch(/bắt buộc/i)
  })
})

describe('/list', () => {
  it('không phải lệnh admin', () => {
    expect(listCommand.adminOnly).toBe(false)
  })

  it('danh sách rỗng thì nói rõ', async () => {
    const { interaction: value, replies } = interaction('list')
    await listCommand.execute(context, value)
    expect(replies[0]?.content).toMatch(/chưa có target/i)
  })

  it('liệt kê target kèm url và chu kỳ', async () => {
    seed('web')
    seed('api')
    const { interaction: value, replies } = interaction('list')
    await listCommand.execute(context, value)
    const text = replies[0]?.content ?? ''
    expect(text).toContain('web')
    expect(text).toContain('api')
    expect(text).toContain('https://web.test')
    expect(text).toContain('60s')
  })

  it('đánh dấu target đang pause', async () => {
    const target = seed('staging')
    context.targets.setPause(target.id, '2026-08-25T00:00:00.000Z')
    const { interaction: value, replies } = interaction('list')
    await listCommand.execute(context, value)
    expect(replies[0]?.content).toContain('paused')
  })

  it('che credentials và query khi hiển thị URL công khai', async () => {
    context.targets.create({
      name: 'secret-endpoint',
      url: 'https://user:password@example.test/health?token=top-secret#fragment',
      intervalSeconds: 60,
      timeoutMs: 10_000,
      createdBy: 'u1',
      createdAt: '2026-08-24T00:00:00.000Z',
    })
    const { interaction: value, replies } = interaction('list')
    await listCommand.execute(context, value)
    const content = replies[0]?.content ?? ''
    expect(content).toContain('https://example.test/health?…')
    expect(content).not.toContain('user')
    expect(content).not.toContain('password')
    expect(content).not.toContain('token')
    expect(content).not.toContain('top-secret')
  })

  it('chia trang để liệt kê đủ target mà không reply nào vượt giới hạn Discord', async () => {
    for (let index = 0; index < 32; index++) {
      context.targets.create({
        name: `target-${index}`,
        url: `https://example.test/${'x'.repeat(150)}?token=${'y'.repeat(150)}`,
        intervalSeconds: 60,
        timeoutMs: 10_000,
        createdBy: 'u1',
        createdAt: '2026-08-24T00:00:00.000Z',
      })
    }
    const { interaction: value, replies, followUps } = interaction('list')
    await listCommand.execute(context, value)
    const contents = [...replies, ...followUps].map((reply) => reply.content ?? '')
    expect(contents).toHaveLength(4)
    expect(contents.every((content) => content.length <= 2_000)).toBe(true)
    for (let index = 0; index < 32; index++) {
      expect(contents.join('\n')).toContain(`target-${index}`)
    }
  })

  it('không in URL raw không parse được từ dữ liệu legacy', async () => {
    context.targets.create({
      name: 'legacy',
      url: 'not-a-url?token=top-secret&password=hidden',
      intervalSeconds: 60,
      timeoutMs: 10_000,
      createdBy: 'u1',
      createdAt: '2026-08-24T00:00:00.000Z',
    })
    const { interaction: value, replies } = interaction('list')
    await listCommand.execute(context, value)
    const content = replies[0]?.content ?? ''
    expect(content).toContain('<URL không hợp lệ>')
    expect(content).not.toContain('token')
    expect(content).not.toContain('top-secret')
    expect(content).not.toContain('password')
  })
})
