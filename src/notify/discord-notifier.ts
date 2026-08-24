import type { Logger } from '../shared/logger.js'
import type { AlertMessage } from '../shared/types.js'
import { toEmbed } from './embeds.js'
import type { Notifier } from './notifier.js'

type SendableChannel = {
  isTextBased(): boolean
  send(payload: unknown): Promise<unknown>
}

export type ChannelFetcher = {
  channels: { fetch(id: string): Promise<unknown> }
}

export type DiscordNotifierDeps = {
  client: ChannelFetcher
  logger: Logger
  retryDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

function asSendable(channel: unknown, channelId: string): SendableChannel {
  if (channel == null) {
    throw new Error(`Không tìm thấy channel ${channelId}`)
  }
  const candidate = channel as Partial<SendableChannel>
  if (
    typeof candidate.isTextBased !== 'function' ||
    !candidate.isTextBased() ||
    typeof candidate.send !== 'function'
  ) {
    throw new Error(`Channel ${channelId} không gửi được tin nhắn`)
  }
  return candidate as SendableChannel
}

export function makeDiscordNotifier(deps: DiscordNotifierDeps): Notifier {
  const retryDelayMs = deps.retryDelayMs ?? 1_000
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  return {
    async send(message: AlertMessage, channelId: string): Promise<void> {
      const channel = asSendable(await deps.client.channels.fetch(channelId), channelId)
      const payload = { embeds: [toEmbed(message)] }

      try {
        await channel.send(payload)
      } catch (error) {
        deps.logger.warn(`Gửi vào channel ${channelId} thất bại, thử lại một lần`, error)
        await sleep(retryDelayMs)
        await channel.send(payload)
      }
    },
  }
}
