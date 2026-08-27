import type { AppConfig } from '../config.js'
import type { DestinationsRepo } from '../db/destinations.repo.js'
import type { Destination } from './notifier.js'

export type Routing = {
  /** Destination nhận alert của một target. Fallback là theo từng provider. */
  destinationsFor(targetId: number): Destination[]
  /** Destination nhận digest. Messenger ở đây là identity-driven, xem spec. */
  digestDestinations(): Destination[]
}

export type RoutingDeps = {
  destinations: DestinationsRepo
  config: Pick<AppConfig, 'defaultAlertChannelId' | 'digestChannelId'>
  /** PSID của mọi identity có is_admin = 1. Phase 1 truyền () => []. */
  messengerAdminPsids: () => readonly string[]
}

export function makeRouting(deps: RoutingDeps): Routing {
  return {
    destinationsFor(targetId) {
      const own = deps.destinations.listForTarget(targetId)
      const providersWithOwn = new Set(own.map((row) => row.provider))
      const global = deps.destinations
        .listGlobal()
        .filter((row) => !providersWithOwn.has(row.provider))

      const all = [...own, ...global].map((row) => ({
        provider: row.provider,
        address: row.address,
      }))

      if (all.length === 0) {
        return [{ provider: 'discord', address: deps.config.defaultAlertChannelId }]
      }
      return all
    },

    digestDestinations() {
      return [
        { provider: 'discord', address: deps.config.digestChannelId },
        ...deps.messengerAdminPsids().map((psid) => ({
          provider: 'messenger' as const,
          address: psid,
        })),
      ]
    },
  }
}
