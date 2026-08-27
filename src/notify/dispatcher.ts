import type { Logger } from '../shared/logger.js'
import type { Destination, Dispatcher, Notifier } from './notifier.js'

export type DispatcherDeps = {
  notifiers: readonly Notifier[]
  logger: Logger
}

/**
 * Fan-out một AlertMessage ra nhiều destination. Không bao giờ throw: một provider
 * chết không được phép chặn provider khác, vì Messenger là kênh best-effort còn
 * Discord là kênh đảm bảo.
 */
export function makeDispatcher(deps: DispatcherDeps): Dispatcher {
  const byProvider = new Map(deps.notifiers.map((n) => [n.provider, n]))

  return {
    async dispatch(msg, dests) {
      await Promise.all(
        dests.map(async (dest) => {
          const notifier = byProvider.get(dest.provider)
          if (!notifier) {
            deps.logger.warn(
              `Không có notifier cho provider "${dest.provider}", bỏ qua ${dest.address}`,
            )
            return
          }
          try {
            await notifier.send(msg, dest.address)
          } catch (error) {
            deps.logger.error(`Gửi tới ${dest.provider}:${dest.address} thất bại`, error)
          }
        }),
      )
    },
  }
}
