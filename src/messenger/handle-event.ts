import type { Router } from '../bot/router.js'
import type { Command } from '../bot/types.js'
import type { DestinationsRepo } from '../db/destinations.repo.js'
import type { MessengerRepo } from '../db/messenger.repo.js'
import type { MessengerClient } from '../notify/messenger-client.js'
import type { MessengerFlusher } from '../notify/messenger-flush.js'
import { splitForMessenger } from '../notify/messenger-text.js'
import type { Logger } from '../shared/logger.js'
import type { Clock } from '../shared/time.js'
import { makeMessengerInteraction } from './interaction.js'
import { helpText, parseCommandText } from './parse-command.js'

export type MessengerEventHandler = {
  handle(payload: unknown): Promise<void>
}

export type MessengerEventDeps = {
  messenger: MessengerRepo
  destinations: DestinationsRepo
  flusher: MessengerFlusher
  client: MessengerClient
  router: Router
  commands: readonly Command[]
  adminUserIds: readonly string[]
  clock: Clock
  logger: Logger
}

type MessagingEvent = {
  sender?: { id?: string }
  message?: { mid?: string; text?: string; is_echo?: boolean }
}

type WebhookBody = {
  object?: string
  entry?: Array<{ messaging?: MessagingEvent[] }>
}

export function makeMessengerEventHandler(deps: MessengerEventDeps): MessengerEventHandler {
  async function send(psid: string, texts: readonly string[]): Promise<void> {
    for (const text of texts) {
      await deps.client.sendText(psid, text)
    }
  }

  async function handleOne(event: MessagingEvent): Promise<void> {
    const psid = event.sender?.id
    const message = event.message
    if (psid === undefined || message === undefined) return

    if (message.is_echo === true) return

    const nowIso = deps.clock().toISOString()

    if (message.mid !== undefined && !deps.messenger.markMidSeen(message.mid, nowIso)) return

    const text = (message.text ?? '').trim()
    if (text.length === 0) return

    const identity = deps.messenger.findIdentity(psid)
    if (identity !== null) {
      deps.messenger.touchInbound(psid, nowIso)
      await deps.flusher.flush(psid)
    }

    const consumed = deps.messenger.consumeLinkCode(text.toUpperCase(), nowIso)
    if (consumed !== null) {
      const grantAdmin = deps.adminUserIds.includes(consumed.discordUserId)
      deps.messenger.link({
        psid,
        discordUserId: consumed.discordUserId,
        isAdmin: grantAdmin,
        atIso: nowIso,
      })
      deps.destinations.add({
        targetId: null,
        provider: 'messenger',
        address: psid,
        createdAt: nowIso,
      })
      await send(psid, [
        'Đã liên kết thành công. Từ giờ bạn sẽ nhận alert ở đây.',
        helpText(deps.commands, grantAdmin),
      ])
      return
    }

    if (identity === null) {
      await send(psid, [
        'Chưa liên kết. Chạy /messenger-link trên Discord để lấy mã, rồi nhắn mã đó vào đây.',
      ])
      return
    }

    const parsed = parseCommandText(text, deps.commands)
    if (!parsed.ok) {
      const body =
        parsed.kind === 'unknown-command'
          ? `${parsed.message}\n\n${helpText(deps.commands, identity.isAdmin)}`
          : parsed.message
      await send(psid, splitForMessenger(body))
      return
    }

    await deps.router.handle(
      makeMessengerInteraction({
        commandName: parsed.commandName,
        psid,
        strings: parsed.strings,
        integers: parsed.integers,
        send: (texts) => send(psid, texts),
        typing: () => deps.client.sendTyping(psid),
      }),
    )
  }

  return {
    async handle(payload) {
      const body = payload as WebhookBody
      if (body.object !== 'page') return

      for (const entry of body.entry ?? []) {
        for (const event of entry.messaging ?? []) {
          try {
            await handleOne(event)
          } catch (error) {
            deps.logger.error('Xử lý một event Messenger thất bại', error)
          }
        }
      }
    },
  }
}
