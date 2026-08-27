import { describe, expect, it, mock } from 'bun:test'
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
    followUp: async (payload) => {
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

function command(name: string, adminOnly: boolean, execute = mock(async () => {})): Command {
  return { name, adminOnly, data: { name, toJSON: () => ({}) }, execute }
}

function setup(commands: Command[]) {
  const ctx = {} as CommandContext
  const router = makeRouter({
    commands,
    ctx,
    isAdmin: (id) => id === 'admin-1',
    logger: silentLogger,
  })
  return { router }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('router.handle', () => {
  it('route tới command đúng tên', async () => {
    const execute = mock(async () => {})
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
    const execute = mock(async () => {})
    const { router } = setup([command('add', true, execute)])
    const { interaction, replies } = fakeInteraction('add', 'user-thuong')

    await router.handle(interaction)
    expect(execute).not.toHaveBeenCalled()
    expect(replies[0]?.content).toMatch(/không có quyền/i)
    expect(replies[0]?.flags).toBe(EPHEMERAL)
  })

  it('cho admin dùng lệnh adminOnly', async () => {
    const execute = mock(async () => {})
    const { router } = setup([command('add', true, execute)])
    const { interaction } = fakeInteraction('add', 'admin-1')

    await router.handle(interaction)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('cho mọi người dùng lệnh không adminOnly', async () => {
    const execute = mock(async () => {})
    const { router } = setup([command('list', false, execute)])
    const { interaction } = fakeInteraction('list', 'user-thuong')

    await router.handle(interaction)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('chặn cùng user gửi cùng lệnh khi lần trước chưa hoàn tất', async () => {
    const gate = deferred()
    const execute = mock(() => gate.promise)
    const { router } = setup([command('status', false, execute)])
    const first = fakeInteraction('status', 'user-1')
    const duplicate = fakeInteraction('status', 'user-1')

    const firstRun = router.handle(first.interaction)
    await router.handle(duplicate.interaction)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(duplicate.replies[0]?.content).toMatch(/đang được xử lý/i)
    expect(duplicate.replies[0]?.flags).toBe(EPHEMERAL)

    gate.resolve()
    await firstRun
  })

  it('vẫn cho phép lệnh khác hoặc user khác chạy đồng thời', async () => {
    const statusGate = deferred()
    const statusExecute = mock(() => statusGate.promise)
    const listExecute = mock(async () => {})
    const { router } = setup([
      command('status', false, statusExecute),
      command('list', false, listExecute),
    ])

    const firstRun = router.handle(fakeInteraction('status', 'user-1').interaction)
    const otherCommandRun = router.handle(fakeInteraction('list', 'user-1').interaction)
    const otherUserRun = router.handle(fakeInteraction('status', 'user-2').interaction)

    expect(statusExecute).toHaveBeenCalledTimes(2)
    expect(listExecute).toHaveBeenCalledTimes(1)

    statusGate.resolve()
    await Promise.all([firstRun, otherCommandRun, otherUserRun])
  })

  it('cho phép gửi lại cùng lệnh sau khi lần trước hoàn tất', async () => {
    const execute = mock(async () => {})
    const { router } = setup([command('status', false, execute)])

    await router.handle(fakeInteraction('status', 'user-1').interaction)
    await router.handle(fakeInteraction('status', 'user-1').interaction)

    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('giải phóng khóa lệnh khi command throw', async () => {
    const execute = mock<Command['execute']>()
      .mockRejectedValueOnce(new Error('lệnh nổ'))
      .mockResolvedValueOnce(undefined)
    const { router } = setup([command('status', false, execute)])

    await router.handle(fakeInteraction('status', 'user-1').interaction)
    await router.handle(fakeInteraction('status', 'user-1').interaction)

    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('command throw thì trả lời lỗi và KHÔNG throw ra ngoài', async () => {
    const execute = mock(async () => {
      throw new Error('lệnh nổ')
    })
    const { router } = setup([command('status', false, execute)])
    const { interaction, replies } = fakeInteraction('status', 'user-1')

    await expect(router.handle(interaction)).resolves.toBeUndefined()
    expect(replies.at(-1)?.content).toMatch(/có lỗi/i)
  })

  it('command throw sau khi đã reply thì không làm sập router', async () => {
    const execute = mock(async (_context: CommandContext, interaction: InteractionLike) => {
      await interaction.reply({ content: 'xong một phần' })
      throw new Error('nổ sau khi reply')
    })
    const { router } = setup([command('status', false, execute)])
    const { interaction } = fakeInteraction('status', 'user-1')

    await expect(router.handle(interaction)).resolves.toBeUndefined()
  })

  it('hai router instance không dùng chung khoá chống chạy trùng', async () => {
    let running = 0
    const slow: Command = {
      name: 'slow',
      adminOnly: false,
      data: { name: 'slow', toJSON: () => ({ name: 'slow' }) },
      async execute() {
        running += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
      },
    }

    const ctx = {} as CommandContext
    const discord = makeRouter({
      commands: [slow],
      ctx,
      isAdmin: () => true,
      logger: silentLogger,
    })
    const messenger = makeRouter({
      commands: [slow],
      ctx,
      isAdmin: () => true,
      logger: silentLogger,
    })

    await Promise.all([
      discord.handle(fakeInteraction('slow', '12345').interaction),
      messenger.handle(fakeInteraction('slow', '12345').interaction),
    ])

    expect(running).toBe(2)
  })
})
