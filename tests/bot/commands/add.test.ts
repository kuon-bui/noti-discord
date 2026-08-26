import { beforeEach, describe, expect, it } from 'bun:test'
import { addCommand } from '../../../src/bot/commands/add.js'
import type { CommandContext, InteractionLike, InteractionReply } from '../../../src/bot/types.js'
import { openTestDb } from '../../../src/db/connection.js'
import { makeChecksRepo } from '../../../src/db/checks.repo.js'
import { makeIncidentsRepo } from '../../../src/db/incidents.repo.js'
import { applyMigrations } from '../../../src/db/migrate.js'
import { makeTargetsRepo } from '../../../src/db/targets.repo.js'
import type { Runner } from '../../../src/monitor/runner.js'
import { silentLogger } from '../../../src/shared/logger.js'

type Options = {
  name?: string
  url?: string
  interval?: number
  timeout?: number
  latency?: number
  channel?: { id: string; type: number }
}

function interaction(options: Options, userId = 'admin-1') {
  const replies: InteractionReply[] = []
  const value: InteractionLike = {
    commandName: 'add',
    user: { id: userId },
    options: {
      getString: (name) =>
        name === 'name' ? options.name ?? null : name === 'url' ? options.url ?? null : null,
      getInteger: (name) =>
        name === 'interval'
          ? options.interval ?? null
          : name === 'timeout'
            ? options.timeout ?? null
            : name === 'latency'
              ? options.latency ?? null
              : null,
      getChannel: () => options.channel ?? null,
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
  return { interaction: value, replies }
}

let context: CommandContext

beforeEach(async () => {
  const { db } = openTestDb()
  await applyMigrations(db)
  context = {
    targets: makeTargetsRepo(db),
    checks: makeChecksRepo(db),
    incidents: makeIncidentsRepo(db),
    runner: {} as Runner,
    config: {
      defaultIntervalSeconds: 60,
      defaultTimeoutMs: 10_000,
      defaultLatencyThresholdMs: 2_000,
    } as CommandContext['config'],
    clock: () => new Date('2026-08-24T00:00:00.000Z'),
    logger: silentLogger,
  }
})

describe('/add', () => {
  it('khai báo là lệnh admin', () => {
    expect(addCommand.adminOnly).toBe(true)
    expect(addCommand.name).toBe('add')
  })

  it('tạo target với default từ config', async () => {
    const { interaction: value, replies } = interaction({ name: 'web', url: 'https://a.test' })
    await addCommand.execute(context, value)

    const target = context.targets.findByName('web')
    expect(target?.url).toBe('https://a.test')
    expect(target?.intervalSeconds).toBe(60)
    expect(target?.timeoutMs).toBe(10_000)
    expect(target?.latencyThresholdMs).toBeNull()
    expect(target?.createdBy).toBe('admin-1')
    expect(target?.createdAt).toBe('2026-08-24T00:00:00.000Z')
    expect(replies[0]?.content).toContain('web')
  })

  it('nhận tham số tuỳ chọn', async () => {
    const { interaction: value } = interaction({
      name: 'api',
      url: 'https://b.test',
      interval: 120,
      timeout: 5_000,
      latency: 800,
      channel: { id: 'chan-9', type: 0 },
    })
    await addCommand.execute(context, value)

    const target = context.targets.findByName('api')
    expect(target?.intervalSeconds).toBe(120)
    expect(target?.timeoutMs).toBe(5_000)
    expect(target?.latencyThresholdMs).toBe(800)
    expect(target?.alertChannelId).toBe('chan-9')
  })

  it('che query URL trong xác nhận public nhưng vẫn lưu URL để probe', async () => {
    const { interaction: value, replies } = interaction({
      name: 'private-api',
      url: 'https://example.test/health?token=top-secret',
    })
    await addCommand.execute(context, value)

    expect(context.targets.findByName('private-api')?.url).toContain('token=top-secret')
    expect(replies[0]?.content).toContain('https://example.test/health?…')
    expect(replies[0]?.content).not.toContain('token')
    expect(replies[0]?.content).not.toContain('top-secret')
  })

  it('thiếu name hoặc url thì trả lời lỗi, không tạo gì', async () => {
    const { interaction: value, replies } = interaction({ url: 'https://a.test' })
    await addCommand.execute(context, value)
    expect(context.targets.findAll()).toEqual([])
    expect(replies[0]?.content).toMatch(/bắt buộc/i)
  })

  it('tên sai định dạng thì trả lời lỗi và không tạo', async () => {
    const { interaction: value, replies } = interaction({ name: 'Web Prod', url: 'https://a.test' })
    await addCommand.execute(context, value)
    expect(context.targets.findAll()).toEqual([])
    expect(replies[0]?.content).toMatch(/chữ thường/)
  })

  it('url sai scheme thì trả lời lỗi và không tạo', async () => {
    const { interaction: value, replies } = interaction({ name: 'web', url: 'ftp://a.test' })
    await addCommand.execute(context, value)
    expect(context.targets.findAll()).toEqual([])
    expect(replies[0]?.content).toMatch(/http/)
  })

  it('interval ngoài biên thì trả lời lỗi', async () => {
    const { interaction: value, replies } = interaction({
      name: 'web',
      url: 'https://a.test',
      interval: 5,
    })
    await addCommand.execute(context, value)
    expect(context.targets.findAll()).toEqual([])
    expect(replies[0]?.content).toMatch(/interval/)
  })

  it('channel không phải text channel thì trả lời lỗi', async () => {
    const { interaction: value, replies } = interaction({
      name: 'web',
      url: 'https://a.test',
      channel: { id: 'voice-1', type: 2 },
    })
    await addCommand.execute(context, value)
    expect(context.targets.findAll()).toEqual([])
    expect(replies[0]?.content).toMatch(/text channel/)
  })

  it('trùng tên thì trả lời thân thiện, không throw', async () => {
    const first = interaction({ name: 'web', url: 'https://a.test' })
    await addCommand.execute(context, first.interaction)

    const second = interaction({ name: 'web', url: 'https://b.test' })
    await expect(addCommand.execute(context, second.interaction)).resolves.toBeUndefined()
    expect(second.replies[0]?.content).toMatch(/đã tồn tại/i)
    expect(context.targets.findByName('web')?.url).toBe('https://a.test')
  })

  it('data toJSON được để đăng ký lên Discord', () => {
    const json = addCommand.data.toJSON() as { name: string }
    expect(json.name).toBe('add')
  })
})
