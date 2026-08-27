import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { checkCommand } from '../../../src/bot/commands/check.js'
import { statusCommand } from '../../../src/bot/commands/status.js'
import type {
  CommandContext,
  InteractionLike,
  InteractionReply,
} from '../../../src/bot/types.js'
import { openTestDb } from '../../../src/db/connection.js'
import { applyMigrations } from '../../../src/db/migrate.js'
import type { CheckOutcome, Target } from '../../../src/shared/types.js'
import { makeTestContext } from '../../helpers/context.js'

function interaction(commandName: string, name?: string) {
  const replies: InteractionReply[] = []
  const followUps: InteractionReply[] = []
  const deferred: unknown[] = []
  const value: InteractionLike = {
    commandName,
    user: { id: 'u1' },
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
    deferReply: async (payload) => {
      deferred.push(payload ?? {})
      return {}
    },
    editReply: async (payload) => {
      replies.push(payload)
      return {}
    },
  }
  return { interaction: value, replies, followUps, deferred }
}

let context: CommandContext
let checkByName: ReturnType<typeof mock>

beforeEach(async () => {
  const { db } = openTestDb()
  await applyMigrations(db)
  checkByName = mock(async () => null)
  context = makeTestContext(db, {
    runner: {
      runCheck: async () => {
        throw new Error('không dùng')
      },
      checkByName,
    } as unknown as CommandContext['runner'],
  })
})

function seed(name: string): Target {
  return context.targets.create({
    name,
    url: `https://${name}.test`,
    intervalSeconds: 60,
    timeoutMs: 10_000,
    createdBy: 'u1',
    createdAt: '2026-08-24T00:00:00.000Z',
  })
}

describe('/status', () => {
  it('không phải lệnh admin', () => {
    expect(statusCommand.adminOnly).toBe(false)
  })

  it('không có target nào thì nói rõ', async () => {
    const { interaction: value, replies } = interaction('status')
    await statusCommand.execute(context, value)
    expect(replies[0]?.content).toMatch(/chưa có target/i)
  })

  it('không truyền name thì liệt kê mọi target kèm lần check gần nhất', async () => {
    const target = seed('web')
    context.targets.updateStatus(target.id, 'UP', '2026-08-24T00:00:00.000Z')
    context.checks.insert({
      targetId: target.id,
      checkedAt: '2026-08-24T00:00:00.000Z',
      status: 'UP',
      httpStatus: 200,
      latencyMs: 137,
    })

    const { interaction: value, replies } = interaction('status')
    await statusCommand.execute(context, value)
    const content = replies[0]?.content ?? ''
    expect(content).toContain('web')
    expect(content).toContain('UP')
    expect(content).toContain('137')
  })

  it('truyền name thì chỉ báo target đó', async () => {
    seed('web')
    seed('api')
    const { interaction: value, replies } = interaction('status', 'web')
    await statusCommand.execute(context, value)
    const content = replies[0]?.content ?? ''
    expect(content).toContain('web')
    expect(content).not.toContain('api')
  })

  it('name không tồn tại thì trả lời thân thiện', async () => {
    const { interaction: value, replies } = interaction('status', 'không-có')
    await statusCommand.execute(context, value)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })

  it('target chưa từng check thì không in undefined', async () => {
    seed('web')
    const { interaction: value, replies } = interaction('status', 'web')
    await statusCommand.execute(context, value)
    const content = replies[0]?.content ?? ''
    expect(content).not.toContain('undefined')
    expect(content).toMatch(/chưa check/i)
  })

  it('chia trang status tổng quát mà không làm mất target', async () => {
    for (let index = 0; index < 10; index++) {
      const target = seed(`target-${index}`)
      context.checks.insert({
        targetId: target.id,
        checkedAt: '2026-08-24T00:00:00.000Z',
        status: 'DOWN',
        error: 'x'.repeat(500),
      })
    }

    const { interaction: value, replies, followUps } = interaction('status')
    await statusCommand.execute(context, value)
    const contents = [...replies, ...followUps].map((reply) => reply.content ?? '')
    expect(contents.length).toBeGreaterThan(1)
    expect(contents.every((content) => content.length <= 2_000)).toBe(true)
    for (let index = 0; index < 10; index++) {
      expect(contents.join('\n')).toContain(`target-${index}`)
    }
  })
})

describe('/check', () => {
  it('không phải lệnh admin', () => {
    expect(checkCommand.adminOnly).toBe(false)
  })

  it('defer trước khi chạy probe', async () => {
    seed('web')
    checkByName.mockResolvedValue({
      target: context.targets.findByName('web') as Target,
      result: { ok: true, httpStatus: 200, latencyMs: 88 },
      status: 'UP',
      transition: null,
    } satisfies CheckOutcome)

    const { interaction: value, deferred } = interaction('check', 'web')
    await checkCommand.execute(context, value)
    expect(deferred).toHaveLength(1)
  })

  it('trả kết quả bằng embed qua editReply', async () => {
    seed('web')
    checkByName.mockResolvedValue({
      target: context.targets.findByName('web') as Target,
      result: { ok: true, httpStatus: 200, latencyMs: 88 },
      status: 'UP',
      transition: null,
    } satisfies CheckOutcome)

    const { interaction: value, replies } = interaction('check', 'web')
    await checkCommand.execute(context, value)

    const embeds = replies[0]?.embeds as Array<{ toJSON(): { title: string } }>
    expect(embeds).toHaveLength(1)
    expect(embeds[0]?.toJSON().title).toContain('web')
  })

  it('thiếu name thì trả lời lỗi, không defer', async () => {
    const { interaction: value, replies, deferred } = interaction('check')
    await checkCommand.execute(context, value)
    expect(deferred).toHaveLength(0)
    expect(replies[0]?.content).toMatch(/bắt buộc/i)
  })

  it('target không tồn tại thì editReply thông báo', async () => {
    checkByName.mockResolvedValue(null)
    const { interaction: value, replies } = interaction('check', 'không-có')
    await checkCommand.execute(context, value)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })

  it('probe lỗi sau defer thì editReply message thân thiện', async () => {
    seed('web')
    checkByName.mockRejectedValue(new Error('probe failed'))
    const { interaction: value, replies, deferred } = interaction('check', 'web')

    await expect(checkCommand.execute(context, value)).resolves.toBeUndefined()

    expect(deferred).toHaveLength(1)
    expect(replies[0]?.content).toMatch(/có lỗi/i)
  })
})
