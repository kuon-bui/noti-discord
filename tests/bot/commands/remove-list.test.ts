import { beforeEach, describe, expect, it } from 'vitest'
import { listCommand } from '../../../src/bot/commands/list.js'
import { removeCommand } from '../../../src/bot/commands/remove.js'
import type { CommandContext, InteractionLike, InteractionReply } from '../../../src/bot/types.js'
import { openTestDb } from '../../../src/db/connection.js'
import { makeChecksRepo } from '../../../src/db/checks.repo.js'
import { makeIncidentsRepo } from '../../../src/db/incidents.repo.js'
import { applyMigrations } from '../../../src/db/migrate.js'
import { makeTargetsRepo } from '../../../src/db/targets.repo.js'
import type { Runner } from '../../../src/monitor/runner.js'
import { silentLogger } from '../../../src/shared/logger.js'

function interaction(commandName: string, name?: string) {
  const replies: InteractionReply[] = []
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
    config: {} as CommandContext['config'],
    clock: () => new Date('2026-08-24T00:00:00.000Z'),
    logger: silentLogger,
  }
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

  it('không vượt giới hạn 2000 ký tự của reply Discord', async () => {
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
    const { interaction: value, replies } = interaction('list')
    await listCommand.execute(context, value)
    expect(replies[0]?.content?.length).toBeLessThanOrEqual(2_000)
  })
})
