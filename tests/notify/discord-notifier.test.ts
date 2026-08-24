import { describe, expect, it, vi } from 'vitest'
import {
  makeDiscordNotifier,
  type ChannelFetcher,
} from '../../src/notify/discord-notifier.js'
import { silentLogger } from '../../src/shared/logger.js'
import type { AlertMessage } from '../../src/shared/types.js'

const MESSAGE: AlertMessage = {
  kind: 'down',
  title: '🔴 web đang DOWN',
  description: 'mô tả',
  color: 0xed4245,
  fields: [{ name: 'URL', value: 'https://a.test' }],
  timestampIso: '2026-08-24T03:04:05.000Z',
}

function fakeClient(channel: unknown, options: { throwOnFetch?: boolean } = {}): ChannelFetcher {
  return {
    channels: {
      fetch: async (id: string) => {
        if (options.throwOnFetch) throw new Error(`không lấy được channel ${id}`)
        return channel
      },
    },
  }
}

describe('makeDiscordNotifier', () => {
  it('gửi embed vào đúng channel', async () => {
    const send = vi.fn(async () => ({}))
    const notifier = makeDiscordNotifier({
      client: fakeClient({ isTextBased: () => true, send }),
      logger: silentLogger,
      sleep: async () => {},
    })

    await notifier.send(MESSAGE, 'chan-1')

    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[0] as { embeds: Array<{ toJSON(): { title: string } }> }
    expect(payload.embeds[0]?.toJSON().title).toBe('🔴 web đang DOWN')
  })

  it('channel không tồn tại thì throw', async () => {
    const notifier = makeDiscordNotifier({
      client: fakeClient(null),
      logger: silentLogger,
      sleep: async () => {},
    })
    await expect(notifier.send(MESSAGE, 'chan-1')).rejects.toThrow(/chan-1/)
  })

  it('channel không gửi được tin thì throw', async () => {
    const notifier = makeDiscordNotifier({
      client: fakeClient({ isTextBased: () => false }),
      logger: silentLogger,
      sleep: async () => {},
    })
    await expect(notifier.send(MESSAGE, 'chan-1')).rejects.toThrow(/không gửi được tin/)
  })

  it('lỗi lần đầu thì thử lại đúng một lần rồi thành công', async () => {
    let calls = 0
    const send = vi.fn(async () => {
      calls++
      if (calls === 1) throw new Error('503 từ Discord')
      return {}
    })
    const notifier = makeDiscordNotifier({
      client: fakeClient({ isTextBased: () => true, send }),
      logger: silentLogger,
      sleep: async () => {},
    })

    await notifier.send(MESSAGE, 'chan-1')
    expect(calls).toBe(2)
  })

  it('thất bại cả hai lần thì throw lỗi lần cuối', async () => {
    let calls = 0
    const send = vi.fn(async () => {
      calls++
      throw new Error(`lỗi lần ${calls}`)
    })
    const notifier = makeDiscordNotifier({
      client: fakeClient({ isTextBased: () => true, send }),
      logger: silentLogger,
      sleep: async () => {},
    })

    await expect(notifier.send(MESSAGE, 'chan-1')).rejects.toThrow('lỗi lần 2')
    expect(calls).toBe(2)
  })

  it('chờ đúng retryDelayMs trước khi thử lại', async () => {
    const waits: number[] = []
    let calls = 0
    const send = vi.fn(async () => {
      calls++
      if (calls === 1) throw new Error('tạm thời')
      return {}
    })
    const notifier = makeDiscordNotifier({
      client: fakeClient({ isTextBased: () => true, send }),
      logger: silentLogger,
      retryDelayMs: 1_500,
      sleep: async (ms) => {
        waits.push(ms)
      },
    })

    await notifier.send(MESSAGE, 'chan-1')
    expect(waits).toEqual([1_500])
  })

  it('lỗi khi fetch channel thì throw', async () => {
    const notifier = makeDiscordNotifier({
      client: fakeClient(null, { throwOnFetch: true }),
      logger: silentLogger,
      sleep: async () => {},
    })
    await expect(notifier.send(MESSAGE, 'chan-1')).rejects.toThrow()
  })
})
