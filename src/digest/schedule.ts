import { buildDigest, type DigestInput } from './digest.js'
import type { AppConfig } from '../config.js'
import type { ChecksRepo } from '../db/checks.repo.js'
import type { IncidentsRepo } from '../db/incidents.repo.js'
import type { MetaRepo } from '../db/meta.repo.js'
import type { TargetsRepo } from '../db/targets.repo.js'
import { digestMessage } from '../notify/messages.js'
import type { Notifier } from '../notify/notifier.js'
import type { Logger } from '../shared/logger.js'
import { vnDateString, vnHour, type Clock } from '../shared/time.js'
import type { Target } from '../shared/types.js'

export const LAST_DIGEST_KEY = 'last_digest_date'

const DAY_MS = 24 * 60 * 60 * 1_000

export type DigestJobDeps = {
  targets: TargetsRepo
  checks: ChecksRepo
  incidents: IncidentsRepo
  meta: MetaRepo
  notifier: Notifier
  config: Pick<AppConfig, 'digestHourLocal' | 'digestChannelId' | 'checkRetentionDays'>
  clock: Clock
  logger: Logger
}

export type DigestJobResult = { sent: boolean; reason?: string }

export type DigestJob = { maybeSend(): Promise<DigestJobResult> }

function isPaused(target: Target, now: Date): boolean {
  return target.pausedUntil !== null && Date.parse(target.pausedUntil) > now.getTime()
}

export function makeDigestJob(deps: DigestJobDeps): DigestJob {
  return {
    async maybeSend(): Promise<DigestJobResult> {
      const now = deps.clock()

      if (vnHour(now) < deps.config.digestHourLocal) {
        return { sent: false, reason: 'chưa tới giờ gửi digest' }
      }

      const today = vnDateString(now)
      if (deps.meta.get(LAST_DIGEST_KEY) === today) {
        return { sent: false, reason: 'đã gửi digest hôm nay' }
      }

      const nowIso = now.toISOString()
      const sinceIso = new Date(now.getTime() - DAY_MS).toISOString()

      const inputs: DigestInput[] = deps.targets.findAll().map((target) => ({
        name: target.name,
        currentStatus: target.currentStatus,
        paused: isPaused(target, now),
        stats: deps.checks.statsSince(target.id, sinceIso),
        incidents: deps.incidents.listOverlapping(target.id, sinceIso),
      }))

      const report = buildDigest(inputs, '24 giờ qua', sinceIso, nowIso)
      await deps.notifier.send(digestMessage(report, nowIso), deps.config.digestChannelId)

      deps.meta.set(LAST_DIGEST_KEY, today)

      const cutoffIso = new Date(
        now.getTime() - deps.config.checkRetentionDays * DAY_MS,
      ).toISOString()
      const removed = deps.checks.deleteOlderThan(cutoffIso)
      if (removed > 0) {
        deps.logger.info(`Đã dọn ${removed} dòng checks cũ hơn ${cutoffIso}`)
      }

      return { sent: true }
    },
  }
}
