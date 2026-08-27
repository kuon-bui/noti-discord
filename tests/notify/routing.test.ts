import { describe, expect, it } from 'bun:test'
import type { DestinationRow, DestinationsRepo } from '../../src/db/destinations.repo.js'
import { makeRouting } from '../../src/notify/routing.js'
import type { ProviderName } from '../../src/notify/notifier.js'

const CONFIG = { defaultAlertChannelId: 'default-chan', digestChannelId: 'digest-chan' }

function fakeRepo(rows: readonly DestinationRow[]): DestinationsRepo {
  return {
    add: () => true,
    remove: () => true,
    listForTarget: (targetId) => rows.filter((r) => r.targetId === targetId),
    listGlobal: () => rows.filter((r) => r.targetId === null),
    listByProvider: (p) => rows.filter((r) => r.provider === p),
  }
}

function row(
  targetId: number | null,
  provider: ProviderName,
  address: string,
  id = 1,
): DestinationRow {
  return { id, targetId, provider, address }
}

function routing(rows: readonly DestinationRow[], admins: readonly string[] = []) {
  return makeRouting({
    destinations: fakeRepo(rows),
    config: CONFIG,
    messengerAdminPsids: () => admins,
  })
}

describe('destinationsFor', () => {
  it('rỗng hoàn toàn thì fallback về DEFAULT_ALERT_CHANNEL_ID', () => {
    expect(routing([]).destinationsFor(1)).toEqual([
      { provider: 'discord', address: 'default-chan' },
    ])
  })

  it('có row riêng của target thì dùng nó thay cho global cùng provider', () => {
    const result = routing([
      row(1, 'discord', 'chan-riêng', 1),
      row(null, 'discord', 'chan-global', 2),
    ]).destinationsFor(1)

    expect(result).toEqual([{ provider: 'discord', address: 'chan-riêng' }])
  })

  it('override Discord của target KHÔNG làm im Messenger global', () => {
    const result = routing([
      row(1, 'discord', 'chan-riêng', 1),
      row(null, 'messenger', 'psid-1', 2),
    ]).destinationsFor(1)

    expect(result).toEqual([
      { provider: 'discord', address: 'chan-riêng' },
      { provider: 'messenger', address: 'psid-1' },
    ])
  })

  it('không có row riêng thì lấy global của mọi provider', () => {
    const result = routing([
      row(null, 'discord', 'chan-global', 1),
      row(null, 'messenger', 'psid-1', 2),
    ]).destinationsFor(1)

    expect(result).toEqual([
      { provider: 'discord', address: 'chan-global' },
      { provider: 'messenger', address: 'psid-1' },
    ])
  })

  it('nhiều row cùng provider cho một target thì giữ hết', () => {
    const result = routing([
      row(1, 'messenger', 'psid-1', 1),
      row(1, 'messenger', 'psid-2', 2),
    ]).destinationsFor(1)

    expect(result).toHaveLength(2)
  })
})

describe('digestDestinations', () => {
  it('luôn có DIGEST_CHANNEL_ID và không bị destination Discord global ghi đè', () => {
    expect(routing([row(null, 'discord', 'chan-global')]).digestDestinations()).toEqual([
      { provider: 'discord', address: 'digest-chan' },
    ])
  })

  it('cộng thêm mọi PSID admin', () => {
    expect(routing([], ['psid-a', 'psid-b']).digestDestinations()).toEqual([
      { provider: 'discord', address: 'digest-chan' },
      { provider: 'messenger', address: 'psid-a' },
      { provider: 'messenger', address: 'psid-b' },
    ])
  })

  it('PSID đã link nhưng không phải admin thì không nhận digest', () => {
    // messengerAdminPsids chỉ trả admin; destination messenger global không được kéo vào.
    const result = routing([row(null, 'messenger', 'psid-thường')], []).digestDestinations()
    expect(result).toEqual([{ provider: 'discord', address: 'digest-chan' }])
  })
})
