import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeHttpProbe } from '../../src/monitor/http-probe.js'
import type { Target } from '../../src/shared/types.js'

let server: http.Server
let base: string

beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/ok') {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('ok')
      return
    }
    if (request.url === '/500') {
      response.writeHead(500)
      response.end('lỗi máy chủ')
      return
    }
    if (request.url === '/204') {
      response.writeHead(204)
      response.end()
      return
    }
    if (request.url === '/slow') {
      setTimeout(() => {
        response.writeHead(200)
        response.end('cuối cùng cũng xong')
      }, 500)
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: 1,
    name: 'web',
    url: `${base}/ok`,
    method: 'GET',
    expectedStatus: '200-299',
    latencyThresholdMs: null,
    intervalSeconds: 60,
    timeoutMs: 2_000,
    alertChannelId: null,
    pausedUntil: null,
    currentStatus: 'UNKNOWN',
    lastCheckedAt: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    createdBy: 'u1',
    ...overrides,
  }
}

const noSleep = async () => {}

describe('makeHttpProbe với server thật', () => {
  it('trả ok và status 200', async () => {
    const probe = makeHttpProbe({ sleep: noSleep })
    const result = await probe.run(target())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.httpStatus).toBe(200)
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('status 500 vẫn là ok:true — probe không phán xét status', async () => {
    const probe = makeHttpProbe({ sleep: noSleep })
    const result = await probe.run(target({ url: `${base}/500` }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.httpStatus).toBe(500)
  })

  it('xử lý được response không có body (204)', async () => {
    const probe = makeHttpProbe({ sleep: noSleep })
    const result = await probe.run(target({ url: `${base}/204` }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.httpStatus).toBe(204)
  })

  it('quá timeout thì trả lỗi có chữ timeout', async () => {
    const probe = makeHttpProbe({ attempts: 1, sleep: noSleep })
    const result = await probe.run(target({ url: `${base}/slow`, timeoutMs: 100 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/timeout/i)
  })

  it('cổng không ai nghe thì trả lỗi kết nối', async () => {
    const probe = makeHttpProbe({ attempts: 1, sleep: noSleep })
    const result = await probe.run(target({ url: 'http://127.0.0.1:1/ok', timeoutMs: 1_000 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })
})

describe('makeHttpProbe với fetch giả', () => {
  it('retry lỗi transport rồi thành công ở lần hai', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      if (calls === 1) throw new TypeError('fetch failed')
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const probe = makeHttpProbe({ attempts: 2, fetchImpl, sleep: noSleep })
    const result = await probe.run(target())
    expect(calls).toBe(2)
    expect(result.ok).toBe(true)
  })

  it('KHÔNG retry khi nhận được response, dù status 500', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response('lỗi', { status: 500 })
    }) as unknown as typeof fetch

    const probe = makeHttpProbe({ attempts: 2, fetchImpl, sleep: noSleep })
    await probe.run(target())
    expect(calls).toBe(1)
  })

  it('hết số lần thử thì trả lỗi của lần cuối', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      throw new TypeError(`thất bại lần ${calls}`)
    }) as unknown as typeof fetch

    const probe = makeHttpProbe({ attempts: 2, fetchImpl, sleep: noSleep })
    const result = await probe.run(target())
    expect(calls).toBe(2)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('thất bại lần 2')
  })

  it('chờ đúng retryDelayMs giữa hai lần thử', async () => {
    const waits: number[] = []
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      if (calls === 1) throw new TypeError('fetch failed')
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const probe = makeHttpProbe({
      attempts: 2,
      retryDelayMs: 2_000,
      fetchImpl,
      sleep: async (ms) => {
        waits.push(ms)
      },
    })
    await probe.run(target())
    expect(waits).toEqual([2_000])
  })

  it('đo latency bằng clock được inject', async () => {
    const stamps = [1_000, 1_250]
    let index = 0
    const fetchImpl = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch

    const probe = makeHttpProbe({
      attempts: 1,
      fetchImpl,
      sleep: noSleep,
      now: () => stamps[index++] ?? 0,
    })
    const result = await probe.run(target())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.latencyMs).toBe(250)
  })

  it('truyền đúng method của target', async () => {
    const methods: string[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      methods.push(String(init.method))
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    const probe = makeHttpProbe({ attempts: 1, fetchImpl, sleep: noSleep })
    await probe.run(target({ method: 'HEAD' }))
    expect(methods).toEqual(['HEAD'])
  })
})
