import { beforeEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../../src/db/connection.js'
import { makeChecksRepo } from '../../src/db/checks.repo.js'
import { makeIncidentsRepo } from '../../src/db/incidents.repo.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeTargetsRepo } from '../../src/db/targets.repo.js'
import { makeRunner, type Runner } from '../../src/monitor/runner.js'
import type { Probe } from '../../src/monitor/probe.js'
import { silentLogger } from '../../src/shared/logger.js'
import type { AlertMessage, ProbeResult, Target } from '../../src/shared/types.js'

type Sent = { msg: AlertMessage; channelId: string }

function fakeProbe(results: ProbeResult[]): Probe {
  let index = 0
  return { run: async () => results[Math.min(index++, results.length - 1)] as ProbeResult }
}

function setup(results: ProbeResult[], options: { failNotify?: boolean } = {}) {
  const { db } = openTestDb()
  const sent: Sent[] = []
  const targets = makeTargetsRepo(db)
  const checks = makeChecksRepo(db)
  const incidents = makeIncidentsRepo(db)

  let clockMs = Date.parse('2026-08-24T00:00:00.000Z')
  const advance = (ms: number) => {
    clockMs += ms
  }

  const runner = makeRunner({
    probe: fakeProbe(results),
    targets,
    checks,
    incidents,
    notifier: {
      send: async (message, channelId) => {
        if (options.failNotify) throw new Error('Discord sập')
        sent.push({ msg: message, channelId })
      },
    },
    config: { defaultLatencyThresholdMs: 2_000, defaultAlertChannelId: 'default-chan' },
    clock: () => new Date(clockMs),
    logger: silentLogger,
  })

  return { db, targets, checks, incidents, runner, sent, advance }
}

function seedTarget(
  targets: ReturnType<typeof makeTargetsRepo>,
  overrides: Record<string, unknown> = {},
): Target {
  return targets.create({
    name: 'web',
    url: 'https://a.test',
    intervalSeconds: 60,
    timeoutMs: 10_000,
    createdBy: 'u1',
    createdAt: '2026-08-24T00:00:00.000Z',
    ...overrides,
  })
}

const UP_RESULT: ProbeResult = { ok: true, httpStatus: 200, latencyMs: 100 }
const DOWN_RESULT: ProbeResult = { ok: false, error: 'timeout sau 10000ms' }

describe('runner.runCheck', () => {
  let context: ReturnType<typeof setup>

  beforeEach(async () => {
    context = setup([UP_RESULT])
    await applyMigrations(context.db)
  })

  it('ghi một dòng checks mỗi lần chạy', async () => {
    const target = seedTarget(context.targets)
    await context.runner.runCheck(target)
    const rows = context.checks.listRecent(target.id, 10)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('UP')
    expect(rows[0]?.httpStatus).toBe(200)
    expect(rows[0]?.latencyMs).toBe(100)
  })

  it('cập nhật currentStatus và lastCheckedAt', async () => {
    const target = seedTarget(context.targets)
    await context.runner.runCheck(target)
    const after = context.targets.findById(target.id)
    expect(after?.currentStatus).toBe('UP')
    expect(after?.lastCheckedAt).toBe('2026-08-24T00:00:00.000Z')
  })

  it('UNKNOWN -> UP không bắn alert', async () => {
    const target = seedTarget(context.targets)
    await context.runner.runCheck(target)
    expect(context.sent).toHaveLength(0)
  })
})

describe('runner với chuỗi trạng thái', () => {
  it('UP -> DOWN -> DOWN -> UP bắn đúng 2 alert', async () => {
    const context = setup([UP_RESULT, DOWN_RESULT, DOWN_RESULT, UP_RESULT])
    await applyMigrations(context.db)
    const target = seedTarget(context.targets)

    let current = target
    for (let index = 0; index < 4; index++) {
      const outcome = await context.runner.runCheck(current)
      current = context.targets.findById(target.id) as Target
      expect(outcome.target.id).toBe(target.id)
      context.advance(60_000)
    }

    expect(context.sent.map((sent) => sent.msg.kind)).toEqual(['down', 'recovered'])
    expect(context.checks.listRecent(target.id, 10)).toHaveLength(4)
  })

  it('mở incident khi down và đóng khi hồi phục, kèm downtime đúng', async () => {
    const context = setup([DOWN_RESULT, UP_RESULT])
    await applyMigrations(context.db)
    const target = seedTarget(context.targets)

    await context.runner.runCheck(target)
    expect(context.incidents.findOpen(target.id)).not.toBeNull()

    context.advance(3_725_000)
    await context.runner.runCheck(context.targets.findById(target.id) as Target)

    expect(context.incidents.findOpen(target.id)).toBeNull()
    const recovered = context.sent.find((sent) => sent.msg.kind === 'recovered')
    expect(recovered?.msg.fields.map((field) => field.value).join(' ')).toContain('1h 2m 5s')
  })

  it('down liên tục nhiều lần chỉ mở một incident', async () => {
    const context = setup([DOWN_RESULT, DOWN_RESULT, DOWN_RESULT])
    await applyMigrations(context.db)
    const target = seedTarget(context.targets)

    for (let index = 0; index < 3; index++) {
      await context.runner.runCheck(context.targets.findById(target.id) as Target)
      context.advance(60_000)
    }

    expect(context.incidents.listRecent(target.id, 10)).toHaveLength(1)
    expect(context.sent).toHaveLength(1)
  })

  it('vào DEGRADED không bắn alert nhưng vẫn ghi DB', async () => {
    const context = setup([{ ok: true, httpStatus: 200, latencyMs: 5_000 }])
    await applyMigrations(context.db)
    const target = seedTarget(context.targets)

    await context.runner.runCheck(target)
    expect(context.sent).toHaveLength(0)
    expect(context.checks.listRecent(target.id, 1)[0]?.status).toBe('DEGRADED')
    expect(context.targets.findById(target.id)?.currentStatus).toBe('DEGRADED')
  })
})

describe('runner định tuyến channel', () => {
  it('dùng alertChannelId của target khi có', async () => {
    const context = setup([DOWN_RESULT])
    await applyMigrations(context.db)
    const target = seedTarget(context.targets, { alertChannelId: 'chan-rieng' })
    await context.runner.runCheck(target)
    expect(context.sent[0]?.channelId).toBe('chan-rieng')
  })

  it('dùng channel mặc định khi target không khai báo', async () => {
    const context = setup([DOWN_RESULT])
    await applyMigrations(context.db)
    const target = seedTarget(context.targets)
    await context.runner.runCheck(target)
    expect(context.sent[0]?.channelId).toBe('default-chan')
  })
})

describe('runner khi Discord lỗi', () => {
  it('vẫn ghi DB và vẫn cập nhật trạng thái, không throw', async () => {
    const context = setup([DOWN_RESULT], { failNotify: true })
    await applyMigrations(context.db)
    const target = seedTarget(context.targets)

    await expect(context.runner.runCheck(target)).resolves.toBeDefined()
    expect(context.checks.listRecent(target.id, 1)).toHaveLength(1)
    expect(context.targets.findById(target.id)?.currentStatus).toBe('DOWN')
    expect(context.incidents.findOpen(target.id)).not.toBeNull()
  })
})

describe('runner.checkByName', () => {
  it('trả null khi không có target', async () => {
    const context = setup([UP_RESULT])
    await applyMigrations(context.db)
    expect(await context.runner.checkByName('không-có')).toBeNull()
  })

  it('chạy check khi tìm thấy target', async () => {
    const context = setup([UP_RESULT])
    await applyMigrations(context.db)
    seedTarget(context.targets)
    const outcome = await context.runner.checkByName('web')
    expect(outcome?.status).toBe('UP')
  })
})
