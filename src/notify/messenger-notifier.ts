import type { MessengerRepo } from '../db/messenger.repo.js'
import type { OutboxRepo } from '../db/outbox.repo.js'
import type { Logger } from '../shared/logger.js'
import type { Clock } from '../shared/time.js'
import type { AlertMessage } from '../shared/types.js'
import { isOutsideWindowError, type MessengerClient } from './messenger-client.js'
import { alertMessageToText } from './messenger-text.js'
import type { Notifier } from './notifier.js'

/**
 * Cửa sổ chuẩn của Meta là 24h; ta dùng 23h làm biên an toàn. Chủ động chặn thay vì
 * để Meta từ chối, vì gọi API vi phạm liên tục là đường dẫn tới việc Page bị hạn chế.
 */
export const MESSENGER_WINDOW_MS = 23 * 60 * 60 * 1_000

export type MessengerNotifierDeps = {
  client: MessengerClient
  messenger: MessengerRepo
  outbox: OutboxRepo
  clock: Clock
  logger: Logger
  windowMs?: number
}

export function makeMessengerNotifier(deps: MessengerNotifierDeps): Notifier {
  const windowMs = deps.windowMs ?? MESSENGER_WINDOW_MS

  function enqueue(msg: AlertMessage, psid: string, reason: string, lastError?: string): void {
    deps.outbox.enqueue({
      provider: 'messenger',
      address: psid,
      targetName: msg.targetName ?? null,
      message: msg,
      createdAt: deps.clock().toISOString(),
      lastError: lastError ?? null,
    })
    deps.logger.warn(`Hoãn thông báo Messenger cho ${psid}: ${reason}`)
  }

  return {
    provider: 'messenger',

    async send(msg, psid) {
      const identity = deps.messenger.findIdentity(psid)
      const lastInboundAt = identity?.lastInboundAt

      if (lastInboundAt == null) {
        enqueue(msg, psid, 'chưa có mốc tin nhắn nào từ người nhận')
        return
      }
      if (deps.clock().getTime() - Date.parse(lastInboundAt) > windowMs) {
        enqueue(msg, psid, 'cửa sổ nhắn tin đã đóng')
        return
      }

      try {
        for (const text of alertMessageToText(msg)) {
          await deps.client.sendText(psid, text)
        }
      } catch (error) {
        if (isOutsideWindowError(error)) {
          enqueue(msg, psid, 'Meta từ chối vì ngoài cửa sổ', String(error))
          return
        }
        // Lỗi khác là lỗi thật — để dispatcher log, đừng chôn vào outbox.
        throw error
      }
    },
  }
}
