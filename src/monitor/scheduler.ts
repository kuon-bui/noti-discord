import type { AppConfig } from '../config.js'
import type { TargetsRepo } from '../db/targets.repo.js'
import { runWithLimit } from '../shared/concurrency.js'
import type { Logger } from '../shared/logger.js'
import type { Clock } from '../shared/time.js'
import type { Runner } from './runner.js'

export type SchedulerDeps = {
  targets: TargetsRepo
  runner: Runner
  config: Pick<AppConfig, 'maxConcurrentChecks' | 'tickIntervalMs'>
  clock: Clock
  logger: Logger
  onTickDone?: () => Promise<void>
}

export type Scheduler = {
  tick(): Promise<void>
  start(): void
  stop(): void
}

export function makeScheduler(deps: SchedulerDeps): Scheduler {
  let timer: NodeJS.Timeout | null = null
  let running = false

  async function tick(): Promise<void> {
    const nowIso = deps.clock().toISOString()
    const due = deps.targets.findDue(nowIso)

    if (due.length > 0) {
      deps.logger.debug(`Tick: ${due.length} target tới hạn`)
    }

    await runWithLimit(due, deps.config.maxConcurrentChecks, async (target) => {
      try {
        await deps.runner.runCheck(target)
      } catch (error) {
        deps.logger.error(`Check target "${target.name}" thất bại`, error)
      }
    })

    if (deps.onTickDone) {
      try {
        await deps.onTickDone()
      } catch (error) {
        deps.logger.error('Công việc sau tick thất bại', error)
      }
    }
  }

  return {
    tick,

    start() {
      if (timer) return
      timer = setInterval(() => {
        if (running) {
          deps.logger.warn('Tick trước còn đang chạy, bỏ qua tick này')
          return
        }
        running = true
        void tick()
          .catch((error) => deps.logger.error('Tick thất bại', error))
          .finally(() => {
            running = false
          })
      }, deps.config.tickIntervalMs)
    },

    stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
    },
  }
}
