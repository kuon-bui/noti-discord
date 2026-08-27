import { beforeEach, describe, expect, it } from 'bun:test'
import { openTestDb } from '../../src/db/connection.js'
import { makeChecksRepo } from '../../src/db/checks.repo.js'
import { makeIncidentsRepo } from '../../src/db/incidents.repo.js'
import { makeMetaRepo } from '../../src/db/meta.repo.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeTargetsRepo } from '../../src/db/targets.repo.js'
import { LAST_DIGEST_KEY, makeDigestJob } from '../../src/digest/schedule.js'
import { silentLogger } from '../../src/shared/logger.js'
import type { AlertMessage } from '../../src/shared/types.js'
import type { Destination } from '../../src/notify/notifier.js'

function fakeDispatcher() {
  const sent: Array<{ kind: string; addresses: string[]; msg: AlertMessage }> = []
  return {
    sent,
    dispatcher: {
      async dispatch(msg: AlertMessage, dests: readonly Destination[]) {
        sent.push({ kind: msg.kind, addresses: dests.map((d) => d.address), msg })
      },
    },
  }
}

async function setup(nowIso: string, options: { failNotify?: boolean } = {}) {
  const { db } = openTestDb()
  await applyMigrations(db)

  const targets = makeTargetsRepo(db)
  const checks = makeChecksRepo(db)
  const incidents = makeIncidentsRepo(db)
  const meta = makeMetaRepo(db)
  const { sent, dispatcher: baseDispatcher } = fakeDispatcher()

  const dispatcher = {
    async dispatch(msg: AlertMessage, dests: readonly Destination[]) {
      if (options.failNotify) throw new Error('Discord sập')
      return baseDispatcher.dispatch(msg, dests)
    },
  }

  const job = makeDigestJob({
    targets,
    checks,
    incidents,
    meta,
    dispatcher,
    routing: {
      destinationsFor: () => [],
      digestDestinations: () => [{ provider: 'discord', address: 'digest-chan' }],
    },
    config: { digestHourLocal: 9, checkRetentionDays: 30 },
    clock: () => new Date(nowIso),
    logger: silentLogger,
  })

  return { targets, checks, incidents, meta, job, sent }
}

function seed(targets: ReturnType<typeof makeTargetsRepo>, name: string) {
  return targets.create({
    name,
    url: `https://${name}.test`,
    intervalSeconds: 60,
    timeoutMs: 10_000,
    createdBy: 'u1',
    createdAt: '2026-08-24T00:00:00.000Z',
  })
}

/** digestMessage trả bảng dạng dữ liệu (table.rows), không còn pad sẵn vào description. */
function digestTableFlat(sent: Array<{ kind: string; addresses: string[]; msg: AlertMessage }>): string {
  return (sent[0]?.msg.table?.rows ?? []).flat().join('|')
}

const AT_9AM_VN = '2026-08-24T02:00:00.000Z'
const AT_8AM_VN = '2026-08-24T01:00:00.000Z'
const AT_2PM_VN = '2026-08-24T07:00:00.000Z'

describe('digestJob.maybeSend', () => {
  it('chưa tới giờ thì không gửi', async () => {
    const context = await setup(AT_8AM_VN)
    const result = await context.job.maybeSend()
    expect(result.sent).toBe(false)
    expect(result.reason).toMatch(/chưa tới giờ/)
    expect(context.sent).toHaveLength(0)
  })

  it('đúng giờ và chưa gửi hôm nay thì gửi', async () => {
    const context = await setup(AT_9AM_VN)
    seed(context.targets, 'web')
    const result = await context.job.maybeSend()
    expect(result.sent).toBe(true)
    expect(context.sent).toHaveLength(1)
    expect(context.sent[0]?.kind).toBe('digest')
    expect(context.sent[0]?.addresses).toContain('digest-chan')
  })

  it('ghi ngày đã gửi vào meta theo lịch VN', async () => {
    const context = await setup(AT_9AM_VN)
    await context.job.maybeSend()
    expect(context.meta.get(LAST_DIGEST_KEY)).toBe('2026-08-24')
  })

  it('gọi lần hai trong cùng ngày thì không gửi lại', async () => {
    const context = await setup(AT_9AM_VN)
    await context.job.maybeSend()
    const second = await context.job.maybeSend()
    expect(second.sent).toBe(false)
    expect(second.reason).toMatch(/đã gửi/)
    expect(context.sent).toHaveLength(1)
  })

  it('restart lúc 14h mà sáng chưa gửi thì vẫn gửi bù', async () => {
    const context = await setup(AT_2PM_VN)
    const result = await context.job.maybeSend()
    expect(result.sent).toBe(true)
  })

  it('meta ghi ngày hôm qua thì hôm nay vẫn gửi', async () => {
    const context = await setup(AT_9AM_VN)
    context.meta.set(LAST_DIGEST_KEY, '2026-08-23')
    expect((await context.job.maybeSend()).sent).toBe(true)
  })

  it('gửi thất bại thì KHÔNG ghi meta, để lần tick sau thử lại', async () => {
    const context = await setup(AT_9AM_VN, { failNotify: true })
    await expect(context.job.maybeSend()).rejects.toThrow('Discord sập')
    expect(context.meta.get(LAST_DIGEST_KEY)).toBeNull()
  })

  it('gửi thất bại vẫn dọn checks hết hạn', async () => {
    const context = await setup(AT_9AM_VN, { failNotify: true })
    const target = seed(context.targets, 'web')
    context.checks.insert({
      targetId: target.id,
      checkedAt: '2026-06-01T00:00:00.000Z',
      status: 'UP',
    })

    await expect(context.job.maybeSend()).rejects.toThrow('Discord sập')
    expect(context.checks.listRecent(target.id, 10)).toHaveLength(0)
  })

  it('không có target nào thì vẫn gửi báo cáo rỗng', async () => {
    const context = await setup(AT_9AM_VN)
    expect((await context.job.maybeSend()).sent).toBe(true)
    expect(context.sent[0]?.msg.table?.rows).toHaveLength(0)
  })

  it('đánh dấu target đang pause', async () => {
    const context = await setup(AT_9AM_VN)
    const target = seed(context.targets, 'staging')
    context.targets.setPause(target.id, '2026-08-25T00:00:00.000Z')
    await context.job.maybeSend()
    expect(digestTableFlat(context.sent)).toContain('paused')
  })

  it('target hết hạn pause thì không còn nhãn paused', async () => {
    const context = await setup(AT_9AM_VN)
    const target = seed(context.targets, 'staging')
    context.targets.setPause(target.id, '2026-08-24T01:00:00.000Z')
    await context.job.maybeSend()
    expect(digestTableFlat(context.sent)).not.toContain('paused')
  })

  it('dọn check cũ hơn CHECK_RETENTION_DAYS và giữ check mới', async () => {
    const context = await setup(AT_9AM_VN)
    const target = seed(context.targets, 'web')
    context.checks.insert({
      targetId: target.id,
      checkedAt: '2026-06-01T00:00:00.000Z',
      status: 'UP',
      latencyMs: 100,
    })
    context.checks.insert({
      targetId: target.id,
      checkedAt: '2026-08-24T01:00:00.000Z',
      status: 'UP',
      latencyMs: 100,
    })

    await context.job.maybeSend()

    const left = context.checks.listRecent(target.id, 10)
    expect(left).toHaveLength(1)
    expect(left[0]?.checkedAt).toBe('2026-08-24T01:00:00.000Z')
  })

  it('báo cáo tính uptime từ dữ liệu 24 giờ gần nhất', async () => {
    const context = await setup(AT_9AM_VN)
    const target = seed(context.targets, 'web')
    context.checks.insert({
      targetId: target.id,
      checkedAt: '2026-08-23T20:00:00.000Z',
      status: 'UP',
      latencyMs: 100,
    })
    context.checks.insert({
      targetId: target.id,
      checkedAt: '2026-08-24T01:00:00.000Z',
      status: 'DOWN',
    })
    context.checks.insert({
      targetId: target.id,
      checkedAt: '2026-08-20T00:00:00.000Z',
      status: 'DOWN',
    })

    await context.job.maybeSend()
    expect(digestTableFlat(context.sent)).toContain('50%')
  })

  it('digest tới DIGEST_CHANNEL_ID cộng mọi PSID admin', async () => {
    const { db } = openTestDb()
    await applyMigrations(db)

    const targets = makeTargetsRepo(db)
    const checks = makeChecksRepo(db)
    const incidents = makeIncidentsRepo(db)
    const meta = makeMetaRepo(db)

    const { sent, dispatcher } = fakeDispatcher()
    const job = makeDigestJob({
      targets,
      checks,
      incidents,
      meta,
      dispatcher,
      routing: {
        destinationsFor: () => [],
        digestDestinations: () => [
          { provider: 'discord', address: 'digest-chan' },
          { provider: 'messenger', address: 'psid-admin' },
        ],
      },
      config: { digestHourLocal: 9, checkRetentionDays: 30 },
      clock: () => new Date('2026-08-26T05:00:00.000Z'),
      logger: silentLogger,
    })

    const result = await job.maybeSend()

    expect(result.sent).toBe(true)
    expect(sent[0]?.addresses).toEqual(['digest-chan', 'psid-admin'])
  })
})
