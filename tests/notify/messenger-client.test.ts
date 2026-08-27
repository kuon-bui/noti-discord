import { describe, expect, it } from 'bun:test'
import {
  isOutsideWindowError,
  makeMessengerClient,
  MessengerApiError,
} from '../../src/notify/messenger-client.js'
import { silentLogger } from '../../src/shared/logger.js'

type Captured = { url: string; init: RequestInit }

function client(response: Response, captured: Captured[] = []) {
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} })
    return response
  }) as unknown as typeof fetch

  return {
    captured,
    client: makeMessengerClient({
      pageAccessToken: 'secret-token',
      apiVersion: 'v21.0',
      fetchImpl,
      logger: silentLogger,
    }),
  }
}

describe('makeMessengerClient', () => {
  it('gửi text đúng endpoint, đúng body, token trong header', async () => {
    const { client: c, captured } = client(new Response('{}', { status: 200 }))
    await c.sendText('psid-1', 'xin chào')

    expect(captured[0]?.url).toBe('https://graph.facebook.com/v21.0/me/messages')
    expect(captured[0]?.url).not.toContain('secret-token')

    const headers = captured[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer secret-token')

    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({
      recipient: { id: 'psid-1' },
      messaging_type: 'RESPONSE',
      message: { text: 'xin chào' },
    })
  })

  it('sendTyping gửi sender_action', async () => {
    const { client: c, captured } = client(new Response('{}', { status: 200 }))
    await c.sendTyping('psid-1')

    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({
      recipient: { id: 'psid-1' },
      sender_action: 'typing_on',
    })
  })

  it('lỗi HTTP thì throw MessengerApiError mang code và subcode', async () => {
    const body = JSON.stringify({
      error: { code: 10, error_subcode: 2_018_278, message: 'outside window' },
    })
    const { client: c } = client(new Response(body, { status: 400 }))

    try {
      await c.sendText('psid-1', 'x')
      throw new Error('phải throw')
    } catch (error) {
      expect(error).toBeInstanceOf(MessengerApiError)
      const api = error as MessengerApiError
      expect(api.code).toBe(10)
      expect(api.subcode).toBe(2_018_278)
      expect(api.httpStatus).toBe(400)
      expect(api.message).toContain('outside window')
    }
  })

  it('body lỗi không phải JSON vẫn throw có ngữ cảnh', async () => {
    const { client: c } = client(new Response('gateway sập', { status: 502 }))
    await expect(c.sendText('psid-1', 'x')).rejects.toThrow(/502/)
  })
})

describe('isOutsideWindowError', () => {
  it('nhận đúng lỗi ngoài cửa sổ', () => {
    expect(isOutsideWindowError(new MessengerApiError('m', 10))).toBe(true)
    expect(isOutsideWindowError(new MessengerApiError('m', undefined, 2_018_278))).toBe(true)
  })

  it('không nhận lỗi khác — token sai không được coi là hết cửa sổ', () => {
    expect(isOutsideWindowError(new MessengerApiError('m', 190))).toBe(false)
    expect(isOutsideWindowError(new MessengerApiError('m', 100))).toBe(false)
    expect(isOutsideWindowError(new Error('bất kỳ'))).toBe(false)
  })
})
