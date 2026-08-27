import { beforeEach, describe, expect, it } from 'bun:test'
import { historyCommand } from '../../../src/bot/commands/history.js'
import { pauseCommand, resumeCommand } from '../../../src/bot/commands/pause.js'
import { uptimeCommand } from '../../../src/bot/commands/uptime.js'
import type {
  CommandContext,
  InteractionLike,
  InteractionReply,
} from '../../../src/bot/types.js'
import { openTestDb } from '../../../src/db/connection.js'
import { applyMigrations } from '../../../src/db/migrate.js'
import type { Target } from '../../../src/shared/types.js'
import { makeTestContext } from '../../helpers/context.js'

const NOW = '2026-08-24T12:00:00.000Z'

function interaction(
  commandName: string,
  options: { name?: string; minutes?: number; range?: string } = {},
) {
  const replies: InteractionReply[] = []
  const followUps: InteractionReply[] = []
  const value: InteractionLike = {
    commandName,
    user: { id: 'admin-1' },
    options: {
      getString: (name) =>
        name === 'name'
          ? options.name ?? null
          : name === 'range'
            ? options.range ?? null
            : null,
      getInteger: (name) => (name === 'minutes' ? options.minutes ?? null : null),
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
  context = makeTestContext(db, { clock: () => new Date(NOW) })
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

describe('/pause', () => {
  it('là lệnh admin', () => {
    expect(pauseCommand.adminOnly).toBe(true)
    expect(resumeCommand.adminOnly).toBe(true)
  })

  it('pause với số phút thì đặt pausedUntil đúng mốc', async () => {
    const target = seed('web')
    const { interaction: value, replies } = interaction('pause', { name: 'web', minutes: 30 })
    await pauseCommand.execute(context, value)
    expect(context.targets.findById(target.id)?.pausedUntil).toBe('2026-08-24T12:30:00.000Z')
    expect(replies[0]?.content).toContain('30')
  })

  it('pause không truyền phút thì pause vô hạn', async () => {
    const target = seed('web')
    const { interaction: value, replies } = interaction('pause', { name: 'web' })
    await pauseCommand.execute(context, value)
    const until = context.targets.findById(target.id)?.pausedUntil ?? ''
    expect(Date.parse(until)).toBeGreaterThan(Date.parse('9000-01-01T00:00:00.000Z'))
    expect(replies[0]?.content).toMatch(/vô hạn|cho tới khi/i)
  })

  it('pause target không tồn tại thì trả lời thân thiện', async () => {
    const { interaction: value, replies } = interaction('pause', { name: 'không-có' })
    await pauseCommand.execute(context, value)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })

  it('minutes ngoài biên thì trả lời lỗi', async () => {
    seed('web')
    const { interaction: value, replies } = interaction('pause', { name: 'web', minutes: 0 })
    await pauseCommand.execute(context, value)
    expect(replies[0]?.content).toMatch(/minutes/)
    expect(context.targets.findByName('web')?.pausedUntil).toBeNull()
  })
})

describe('/resume', () => {
  it('bỏ pause', async () => {
    const target = seed('web')
    context.targets.setPause(target.id, '2026-08-25T00:00:00.000Z')
    const { interaction: value, replies } = interaction('resume', { name: 'web' })
    await resumeCommand.execute(context, value)
    expect(context.targets.findById(target.id)?.pausedUntil).toBeNull()
    expect(replies[0]?.content).toContain('web')
  })

  it('target không tồn tại thì trả lời thân thiện', async () => {
    const { interaction: value, replies } = interaction('resume', { name: 'không-có' })
    await resumeCommand.execute(context, value)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })
})

describe('/history', () => {
  it('không phải lệnh admin', () => {
    expect(historyCommand.adminOnly).toBe(false)
  })

  it('chưa có sự cố thì nói rõ', async () => {
    seed('web')
    const { interaction: value, replies } = interaction('history', { name: 'web' })
    await historyCommand.execute(context, value)
    expect(replies[0]?.content).toMatch(/chưa có sự cố/i)
  })

  it('liệt kê sự cố đã đóng kèm thời lượng', async () => {
    const target = seed('web')
    context.incidents.open(target.id, 'HTTP 500', '2026-08-24T01:00:00.000Z')
    context.incidents.close(target.id, '2026-08-24T02:02:05.000Z')

    const { interaction: value, replies } = interaction('history', { name: 'web' })
    await historyCommand.execute(context, value)
    const content = replies[0]?.content ?? ''
    expect(content).toContain('HTTP 500')
    expect(content).toContain('1h 2m 5s')
  })

  it('đánh dấu sự cố còn đang mở', async () => {
    const target = seed('web')
    context.incidents.open(target.id, 'timeout', '2026-08-24T11:00:00.000Z')
    const { interaction: value, replies } = interaction('history', { name: 'web' })
    await historyCommand.execute(context, value)
    expect(replies[0]?.content).toMatch(/đang diễn ra/i)
  })

  it('target không tồn tại thì trả lời thân thiện', async () => {
    const { interaction: value, replies } = interaction('history', { name: 'không-có' })
    await historyCommand.execute(context, value)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })

  it('chia trang khi reason lịch sử dài nhưng giữ đủ incident', async () => {
    const target = seed('web')
    for (let index = 0; index < 10; index++) {
      context.incidents.open(target.id, `reason-${index}-${'x'.repeat(500)}`, `2026-08-24T0${index}:00:00.000Z`)
      context.incidents.close(target.id, `2026-08-24T0${index}:01:00.000Z`)
    }

    const { interaction: value, replies, followUps } = interaction('history', { name: 'web' })
    await historyCommand.execute(context, value)
    const contents = [...replies, ...followUps].map((reply) => reply.content ?? '')
    expect(contents.length).toBeGreaterThan(1)
    expect(contents.every((content) => content.length <= 2_000)).toBe(true)
    for (let index = 0; index < 10; index++) {
      expect(contents.join('\n')).toContain(`reason-${index}`)
    }
  })
})

describe('/uptime', () => {
  it('không phải lệnh admin', () => {
    expect(uptimeCommand.adminOnly).toBe(false)
  })

  it('tính uptime trong 24h theo mặc định', async () => {
    const target = seed('web')
    context.checks.insert({
      targetId: target.id,
      checkedAt: '2026-08-24T11:00:00.000Z',
      status: 'UP',
      latencyMs: 100,
    })
    context.checks.insert({
      targetId: target.id,
      checkedAt: '2026-08-24T11:30:00.000Z',
      status: 'DOWN',
    })

    const { interaction: value, replies } = interaction('uptime', { name: 'web' })
    await uptimeCommand.execute(context, value)
    const content = replies[0]?.content ?? ''
    expect(content).toContain('50%')
    expect(content).toContain('24h')
  })

  it('range 7d dùng khoảng 7 ngày', async () => {
    const target = seed('web')
    context.checks.insert({
      targetId: target.id,
      checkedAt: '2026-08-20T00:00:00.000Z',
      status: 'UP',
      latencyMs: 100,
    })

    const { interaction: value, replies } = interaction('uptime', { name: 'web', range: '7d' })
    await uptimeCommand.execute(context, value)
    const content = replies[0]?.content ?? ''
    expect(content).toContain('7d')
    expect(content).toContain('100%')
  })

  it('chưa có dữ liệu thì nói rõ, không in NaN', async () => {
    seed('web')
    const { interaction: value, replies } = interaction('uptime', { name: 'web' })
    await uptimeCommand.execute(context, value)
    const content = replies[0]?.content ?? ''
    expect(content).not.toContain('NaN')
    expect(content).toMatch(/chưa có dữ liệu/i)
  })

  it('range không hợp lệ thì trả lời lỗi', async () => {
    seed('web')
    const { interaction: value, replies } = interaction('uptime', { name: 'web', range: '1 tháng' })
    await uptimeCommand.execute(context, value)
    expect(replies[0]?.content).toMatch(/range/)
  })

  it('target không tồn tại thì trả lời thân thiện', async () => {
    const { interaction: value, replies } = interaction('uptime', { name: 'không-có' })
    await uptimeCommand.execute(context, value)
    expect(replies[0]?.content).toMatch(/không tìm thấy/i)
  })
})
