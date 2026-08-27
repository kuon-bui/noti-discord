import type { CommandContext } from '../../src/bot/types.js'
import { makeChecksRepo } from '../../src/db/checks.repo.js'
import type { Db } from '../../src/db/connection.js'
import { makeDestinationsRepo } from '../../src/db/destinations.repo.js'
import { makeIncidentsRepo } from '../../src/db/incidents.repo.js'
import { makeMessengerRepo } from '../../src/db/messenger.repo.js'
import { makeTargetsRepo } from '../../src/db/targets.repo.js'
import type { Runner } from '../../src/monitor/runner.js'
import { silentLogger } from '../../src/shared/logger.js'

export const TEST_NOW = '2026-08-24T00:00:00.000Z'

/**
 * Một chỗ duy nhất dựng CommandContext cho test. Thêm field vào CommandContext
 * thì chỉ sửa file này.
 */
export function makeTestContext(db: Db, overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    targets: makeTargetsRepo(db),
    checks: makeChecksRepo(db),
    incidents: makeIncidentsRepo(db),
    destinations: makeDestinationsRepo(db),
    messenger: makeMessengerRepo(db),
    runner: {} as Runner,
    config: {
      defaultIntervalSeconds: 60,
      defaultTimeoutMs: 10_000,
      defaultLatencyThresholdMs: 2_000,
      defaultAlertChannelId: 'default-chan',
      digestChannelId: 'digest-chan',
    } as CommandContext['config'],
    clock: () => new Date(TEST_NOW),
    logger: silentLogger,
    ...overrides,
  }
}
