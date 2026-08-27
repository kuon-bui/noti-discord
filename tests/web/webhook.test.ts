import crypto from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import { silentLogger } from '../../src/shared/logger.js'
import { makeMessengerWebhook } from '../../src/web/messenger-webhook.js'

const PATH = '/webhook/messenger'
const SECRET = 'app-secret'
const VERIFY = 'verify-token'
const BASE = 'http://localhost'

function app(handleEvent: (payload: unknown) => Promise<void> = async () => {}) {
  return makeMessengerWebhook({
    path: PATH,
    verifyToken: VERIFY,
    appSecret: SECRET,
    logger: silentLogger,
    handleEvent,
  })
}

function signed(bodyText: string, secret = SECRET): Request {
  const raw = new TextEncoder().encode(bodyText)
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`
  return new Request(`${BASE}${PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    body: bodyText,
  })
}

describe('GET verify', () => {
  it('token đúng thì trả challenge', async () => {
    const webhook = app()
    const res = await webhook.handle(
      new Request(`${BASE}${PATH}?hub.mode=subscribe&hub.challenge=xyz&hub.verify_token=${VERIFY}`),
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('xyz')
  })

  it('mode không phải subscribe thì 403', async () => {
    const webhook = app()
    const res = await webhook.handle(
      new Request(`${BASE}${PATH}?hub.mode=unsubscribe&hub.challenge=xyz&hub.verify_token=${VERIFY}`),
    )
    expect(res.status).toBe(403)
  })

  it('token sai thì 403', async () => {
    const webhook = app()
    const res = await webhook.handle(
      new Request(`${BASE}${PATH}?hub.mode=subscribe&hub.challenge=xyz&hub.verify_token=sai`),
    )
    expect(res.status).toBe(403)
  })

  it('thiếu challenge thì 403', async () => {
    const webhook = app()
    const res = await webhook.handle(
      new Request(`${BASE}${PATH}?hub.mode=subscribe&hub.verify_token=${VERIFY}`),
    )
    expect(res.status).toBe(403)
  })
})

describe('POST event', () => {
  it('signature đúng thì gọi handler và trả 200', async () => {
    let called = false
    const webhook = app(async () => {
      called = true
    })
    const body = '{"object":"page","entry":[]}'
    const res = await webhook.handle(signed(body))

    expect(res.status).toBe(200)
    expect(called).toBe(true)
  })

  it('signature sai thì 403, không gọi handler', async () => {
    let called = false
    const webhook = app(async () => {
      called = true
    })
    const body = '{"object":"page","entry":[]}'
    const res = await webhook.handle(signed(body, 'sai'))

    expect(res.status).toBe(403)
    expect(called).toBe(false)
  })

  it('thiếu signature thì 403', async () => {
    let called = false
    const webhook = app(async () => {
      called = true
    })
    const res = await webhook.handle(
      new Request(`${BASE}${PATH}`, {
        method: 'POST',
        body: '{"object":"page","entry":[]}',
      }),
    )

    expect(res.status).toBe(403)
    expect(called).toBe(false)
  })
})
