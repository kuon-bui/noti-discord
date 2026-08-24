import { describe, expect, it, vi } from 'vitest'
import { makeRouter } from '../../src/bot/router.js'
import {
  EPHEMERAL,
  type Command,
  type CommandContext,
  type InteractionLike,
  type InteractionReply,
} from '../../src/bot/types.js'
import { silentLogger } from '../../src/shared/logger.js'

function fakeInteraction(commandName: string, userId: string) {
  const replies: InteractionReply[] = []
  const interaction: InteractionLike = {
    commandName,
    user: { id: userId },
    options: {
      getString: () => null,
      getInteger: () => null,
      getChannel: () => null,
    },
    reply: async (payload) => {
      replies.push(payload)
      return {}
    },
    deferReply: async () => ({}),
    editReply: async (payload) => {
      replies.push(payload)
      return {}
    },
  }
  return { interaction, replies }
}

function command(name: string, adminOnly: boolean, execute = vi.fn(async () => {})): Command {
  return { name, adminOnly, data: { name, toJSON: () => ({}) }, execute }
}

function setup(commands: Command[]) {
  const ctx = {} as CommandContext
  const router = makeRouter({
    commands,
    ctx,
    config: { adminUserIds: ['admin-1'] },
    logger: silentLogger,
  })
  return { router }
}

describe('router.handle', () => {
  it('route tới command đúng tên', async () => {
    const execute = vi.fn(async () => {})
    const { router } = setup([command('status', false, execute), command('list', false)])
    const { interaction } = fakeInteraction('status', 'user-1')

    await router.handle(interaction)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('lệnh không tồn tại thì trả lời ephemeral, không throw', async () => {
    const { router } = setup([command('status', false)])
    const { interaction, replies } = fakeInteraction('không-có', 'user-1')

    await expect(router.handle(interaction)).resolves.toBeUndefined()
    expect(replies[0]?.content).toMatch(/không nhận ra/i)
    expect(replies[0]?.flags).toBe(EPHEMERAL)
  })

  it('chặn user thường dùng lệnh adminOnly', async () => {
    const execute = vi.fn(async () => {})
    const { router } = setup([command('add', true, execute)])
    const { interaction, replies } = fakeInteraction('add', 'user-thuong')

    await router.handle(interaction)
    expect(execute).not.toHaveBeenCalled()
    expect(replies[0]?.content).toMatch(/không có quyền/i)
    expect(replies[0]?.flags).toBe(EPHEMERAL)
  })

  it('cho admin dùng lệnh adminOnly', async () => {
    const execute = vi.fn(async () => {})
    const { router } = setup([command('add', true, execute)])
    const { interaction } = fakeInteraction('add', 'admin-1')

    await router.handle(interaction)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('cho mọi người dùng lệnh không adminOnly', async () => {
    const execute = vi.fn(async () => {})
    const { router } = setup([command('list', false, execute)])
    const { interaction } = fakeInteraction('list', 'user-thuong')

    await router.handle(interaction)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('command throw thì trả lời lỗi và KHÔNG throw ra ngoài', async () => {
    const execute = vi.fn(async () => {
      throw new Error('lệnh nổ')
    })
    const { router } = setup([command('status', false, execute)])
    const { interaction, replies } = fakeInteraction('status', 'user-1')

    await expect(router.handle(interaction)).resolves.toBeUndefined()
    expect(replies.at(-1)?.content).toMatch(/có lỗi/i)
  })

  it('command throw sau khi đã reply thì không làm sập router', async () => {
    const execute = vi.fn(async (_context: CommandContext, interaction: InteractionLike) => {
      await interaction.reply({ content: 'xong một phần' })
      throw new Error('nổ sau khi reply')
    })
    const { router } = setup([command('status', false, execute)])
    const { interaction } = fakeInteraction('status', 'user-1')

    await expect(router.handle(interaction)).resolves.toBeUndefined()
  })
})
