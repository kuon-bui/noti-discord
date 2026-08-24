import type { AppConfig } from '../config.js'
import type { ChecksRepo } from '../db/checks.repo.js'
import type { IncidentsRepo } from '../db/incidents.repo.js'
import type { TargetsRepo } from '../db/targets.repo.js'
import { downMessage, reasonOf, recoveredMessage } from '../notify/messages.js'
import type { Notifier } from '../notify/notifier.js'
import type { Logger } from '../shared/logger.js'
import type { Clock } from '../shared/time.js'
import type { AlertMessage, CheckOutcome, Target } from '../shared/types.js'
import { evaluate } from './evaluate.js'
import type { Probe } from './probe.js'
import { transitionFor } from './state-machine.js'

export type RunnerDeps = {
  probe: Probe
  targets: TargetsRepo
  checks: ChecksRepo
  incidents: IncidentsRepo
  notifier: Notifier
  config: Pick<AppConfig, 'defaultLatencyThresholdMs' | 'defaultAlertChannelId'>
  clock: Clock
  logger: Logger
}

export type Runner = {
  runCheck(target: Target): Promise<CheckOutcome>
  checkByName(name: string): Promise<CheckOutcome | null>
}

export function makeRunner(deps: RunnerDeps): Runner {
  const channelOf = (target: Target): string =>
    target.alertChannelId ?? deps.config.defaultAlertChannelId

  async function notifySafe(message: AlertMessage, channelId: string): Promise<void> {
    try {
      await deps.notifier.send(message, channelId)
    } catch (error) {
      deps.logger.error(`Không gửi được alert vào channel ${channelId}`, error)
    }
  }

  async function runCheck(target: Target): Promise<CheckOutcome> {
    const result = await deps.probe.run(target)
    const status = evaluate(result, target, deps.config.defaultLatencyThresholdMs)
    const at = deps.clock().toISOString()

    deps.checks.insert({
      targetId: target.id,
      checkedAt: at,
      status,
      httpStatus: result.ok ? result.httpStatus : (result.httpStatus ?? null),
      latencyMs: result.latencyMs ?? null,
      error: result.ok ? null : result.error,
    })

    const transition = transitionFor(target.currentStatus, status)

    if (transition?.kind === 'down') {
      deps.incidents.open(target.id, reasonOf(result), at)
      await notifySafe(downMessage(target, result, at), channelOf(target))
    } else if (transition?.kind === 'recovered') {
      const open = deps.incidents.findOpen(target.id)
      deps.incidents.close(target.id, at)
      const downtimeMs = open ? Date.parse(at) - Date.parse(open.startedAt) : 0
      await notifySafe(recoveredMessage(target, downtimeMs, at), channelOf(target))
    }

    deps.targets.updateStatus(target.id, status, at)

    return { target, result, status, transition }
  }

  return {
    runCheck,

    async checkByName(name) {
      const target = deps.targets.findByName(name)
      if (!target) return null
      return runCheck(target)
    },
  }
}
