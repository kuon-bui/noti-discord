import type { OutboxRepo } from '../db/outbox.repo.js'
import type { TargetsRepo } from '../db/targets.repo.js'
import type { Logger } from '../shared/logger.js'
import type { Clock } from '../shared/time.js'
import type { MessengerClient } from './messenger-client.js'
import { alertMessageToText, splitForMessenger } from './messenger-text.js'
import { STATUS_ICON } from './messages.js'

export const COLLAPSE_THRESHOLD = 3

const HOUR_MS = 60 * 60 * 1_000

export type MessengerFlusher = {
  flush(psid: string): Promise<void>
}

export type MessengerFlusherDeps = {
  client: MessengerClient
  outbox: OutboxRepo
  targets: TargetsRepo
  clock: Clock
  logger: Logger
  maxAgeHours: number
}

export function makeMessengerFlusher(deps: MessengerFlusherDeps): MessengerFlusher {
  return {
    async flush(psid) {
      const now = deps.clock()
      const cutoffIso = new Date(now.getTime() - deps.maxAgeHours * HOUR_MS).toISOString()
      const dropped = deps.outbox.deleteOlderThan('messenger', psid, cutoffIso)
      if (dropped > 0) {
        deps.logger.info(`Bỏ ${dropped} thông báo Messenger quá hạn của ${psid}`)
      }

      const entries = deps.outbox.listFor('messenger', psid)
      if (entries.length === 0) return

      if (entries.length <= COLLAPSE_THRESHOLD) {
        for (const entry of entries) {
          for (const text of alertMessageToText(entry.message)) {
            await deps.client.sendText(psid, text)
          }
        }
        deps.outbox.deleteIds(entries.map((entry) => entry.id))
        return
      }

      const names = [
        ...new Set(
          entries
            .map((entry) => entry.targetName)
            .filter((name): name is string => name != null),
        ),
      ]
      const statuses = names
        .map((name) => deps.targets.findByName(name))
        .filter((target): target is NonNullable<typeof target> => target != null)
        .map(
          (target) =>
            `${STATUS_ICON[target.currentStatus] ?? '⚪'} ${target.name} — ${target.currentStatus}`,
        )

      const lines = [
        `⚠️ Đã bỏ lỡ ${entries.length} thông báo trong lúc cửa sổ Messenger đóng.`,
      ]
      if (statuses.length > 0) lines.push('Trạng thái hiện tại:', ...statuses)

      for (const text of splitForMessenger(lines.join('\n'))) {
        await deps.client.sendText(psid, text)
      }
      deps.outbox.deleteIds(entries.map((entry) => entry.id))
    },
  }
}
