import { describe, expect, it } from 'bun:test'
import { makeDispatcher } from '../../src/notify/dispatcher.js'
import type { Notifier, ProviderName } from '../../src/notify/notifier.js'
import { silentLogger, type Logger } from '../../src/shared/logger.js'
import type { AlertMessage } from '../../src/shared/types.js'

const MSG: AlertMessage = {
  kind: 'down',
  title: 'x',
  description: 'y',
  color: 1,
  fields: [],
  timestampIso: '2026-08-26T00:00:00.000Z',
}

function spyNotifier(provider: ProviderName, behaviour: 'ok' | 'throw' = 'ok') {
  const calls: string[] = []
  const notifier: Notifier = {
    provider,
    async send(_msg, address) {
      calls.push(address)
      if (behaviour === 'throw') throw new Error('nổ')
    },
  }
  return { notifier, calls }
}

function collectingLogger(): { logger: Logger; warns: string[]; errors: string[] } {
  const warns: string[] = []
  const errors: string[] = []
  return {
    logger: { ...silentLogger, warn: (m) => warns.push(m), error: (m) => errors.push(m) },
    warns,
    errors,
  }
}

describe('makeDispatcher', () => {
  it('gửi mỗi destination tới notifier đúng provider', async () => {
    const discord = spyNotifier('discord')
    const messenger = spyNotifier('messenger')
    const dispatcher = makeDispatcher({
      notifiers: [discord.notifier, messenger.notifier],
      logger: silentLogger,
    })

    await dispatcher.dispatch(MSG, [
      { provider: 'discord', address: 'chan-1' },
      { provider: 'messenger', address: 'psid-9' },
    ])

    expect(discord.calls).toEqual(['chan-1'])
    expect(messenger.calls).toEqual(['psid-9'])
  })

  it('một provider lỗi không chặn provider khác và không throw ra ngoài', async () => {
    const broken = spyNotifier('messenger', 'throw')
    const healthy = spyNotifier('discord')
    const { logger, errors } = collectingLogger()
    const dispatcher = makeDispatcher({
      notifiers: [broken.notifier, healthy.notifier],
      logger,
    })

    await expect(
      dispatcher.dispatch(MSG, [
        { provider: 'messenger', address: 'psid-9' },
        { provider: 'discord', address: 'chan-1' },
      ]),
    ).resolves.toBeUndefined()

    expect(healthy.calls).toEqual(['chan-1'])
    expect(errors.some((m) => m.includes('psid-9'))).toBe(true)
  })

  it('provider không có notifier thì chỉ log warn, không throw', async () => {
    const { logger, warns } = collectingLogger()
    const dispatcher = makeDispatcher({ notifiers: [], logger })

    await expect(
      dispatcher.dispatch(MSG, [{ provider: 'messenger', address: 'psid-9' }]),
    ).resolves.toBeUndefined()

    expect(warns.some((m) => m.includes('messenger'))).toBe(true)
  })

  it('danh sách destination rỗng thì không làm gì', async () => {
    const discord = spyNotifier('discord')
    const dispatcher = makeDispatcher({ notifiers: [discord.notifier], logger: silentLogger })
    await dispatcher.dispatch(MSG, [])
    expect(discord.calls).toEqual([])
  })
})
