import { describe, expect, it, jest, mock } from 'bun:test'
import type { TargetsRepo } from '../../src/db/targets.repo.js'
import { makeScheduler } from '../../src/monitor/scheduler.js'
import type { Runner } from '../../src/monitor/runner.js'
import { silentLogger } from '../../src/shared/logger.js'
import type { CheckOutcome, Target } from '../../src/shared/types.js'

function target(name: string, id: number): Target {
  return {
    id,
    name,
    url: `https://${name}.test`,
    method: 'GET',
    expectedStatus: '200-299',
    latencyThresholdMs: null,
    intervalSeconds: 60,
    timeoutMs: 10_000,
    alertChannelId: null,
    pausedUntil: null,
    currentStatus: 'UP',
    lastCheckedAt: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    createdBy: 'u1',
  }
}

function setup(due: Target[], runCheck?: Runner['runCheck']) {
  const calls: string[] = []
  const targets = {
    findDue: mock(() => due),
  } as unknown as TargetsRepo

  const runner = {
    runCheck:
      runCheck ??
      (async (item: Target) => {
        calls.push(item.name)
        return {
          target: item,
          result: { ok: true, httpStatus: 200, latencyMs: 1 },
          status: 'UP',
          transition: null,
        } as CheckOutcome
      }),
    checkByName: async () => null,
  } as Runner

  const scheduler = makeScheduler({
    targets,
    runner,
    config: { maxConcurrentChecks: 2, tickIntervalMs: 10_000 },
    clock: () => new Date('2026-08-24T00:00:00.000Z'),
    logger: silentLogger,
  })

  return { scheduler, calls, targets, runner }
}

// Chỉ đợi microtask, không có timer/I-O thật nào trong chuỗi runCheck/runWithLimit giả
// lập bên dưới — nếu đường code này sau này có setTimeout/I-O thật, hàm này sẽ flush
// thiếu một cách âm thầm thay vì báo lỗi rõ ràng.
async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

describe('scheduler.tick', () => {
  it('gọi runCheck cho từng target tới hạn', async () => {
    const context = setup([target('a', 1), target('b', 2)])
    await context.scheduler.tick()
    expect(context.calls.sort()).toEqual(['a', 'b'])
  })

  it('truyền mốc thời gian từ clock vào findDue', async () => {
    const context = setup([])
    await context.scheduler.tick()
    expect(context.targets.findDue).toHaveBeenCalledWith('2026-08-24T00:00:00.000Z')
  })

  it('không có target tới hạn thì không gọi runCheck', async () => {
    const context = setup([])
    await context.scheduler.tick()
    expect(context.calls).toEqual([])
  })

  it('một target lỗi không chặn các target khác', async () => {
    const done: string[] = []
    const context = setup([target('a', 1), target('b', 2), target('c', 3)], async (item) => {
      if (item.name === 'b') throw new Error('probe nổ')
      done.push(item.name)
      return {
        target: item,
        result: { ok: true, httpStatus: 200, latencyMs: 1 },
        status: 'UP',
        transition: null,
      } as CheckOutcome
    })

    await expect(context.scheduler.tick()).resolves.toBeUndefined()
    expect(done.sort()).toEqual(['a', 'c'])
  })
})

describe('scheduler.start và stop', () => {
  it('start chạy tick theo chu kỳ, stop thì dừng', async () => {
    // bun:test chạy toàn bộ 27 file test trong một process duy nhất (không như vitest
    // pool: 'forks' trước đây), nên jest.useFakeTimers() là global cho cả process, không
    // chỉ riêng file này — finally bên dưới bắt buộc phải khôi phục real timers, nếu
    // không mọi test chạy sau file này sẽ bị ảnh hưởng.
    jest.useFakeTimers()
    try {
      const context = setup([target('a', 1)])
      context.scheduler.start()

      jest.advanceTimersByTime(10_000)
      await flushMicrotasks()
      jest.advanceTimersByTime(10_000)
      await flushMicrotasks()
      const afterTwoTicks = context.calls.length
      expect(afterTwoTicks).toBeGreaterThanOrEqual(2)

      context.scheduler.stop()
      jest.advanceTimersByTime(30_000)
      await flushMicrotasks()
      expect(context.calls.length).toBe(afterTwoTicks)
    } finally {
      jest.useRealTimers()
    }
  })

  it('stop khi chưa start không lỗi', () => {
    const context = setup([])
    expect(() => context.scheduler.stop()).not.toThrow()
  })
})
