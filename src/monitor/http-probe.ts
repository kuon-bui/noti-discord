import type { ProbeResult, Target } from '../shared/types.js'
import type { Probe } from './probe.js'

export type HttpProbeOptions = {
  attempts?: number
  retryDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  fetchImpl?: typeof fetch
  now?: () => number
}

function describeError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return `timeout sau ${timeoutMs}ms`
    if (error.name === 'AbortError') return 'bị huỷ trước khi hoàn tất'
    const cause = (error as { cause?: unknown }).cause
    if (cause instanceof Error && cause.message) return `${error.message}: ${cause.message}`
    return error.message
  }
  return String(error)
}

export function makeHttpProbe(options: HttpProbeOptions = {}): Probe {
  const attempts = options.attempts ?? 2
  const retryDelayMs = options.retryDelayMs ?? 2_000
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const doFetch = options.fetchImpl ?? fetch
  const now = options.now ?? (() => performance.now())

  async function attempt(target: Target): Promise<ProbeResult> {
    const started = now()
    try {
      const response = await doFetch(target.url, {
        method: target.method,
        signal: AbortSignal.timeout(target.timeoutMs),
        redirect: 'follow',
      })
      const latencyMs = Math.round(now() - started)
      // Read the body even when unused so the keep-alive socket is released.
      await response.arrayBuffer().catch(() => undefined)
      return { ok: true, httpStatus: response.status, latencyMs }
    } catch (error) {
      const latencyMs = Math.round(now() - started)
      return { ok: false, latencyMs, error: describeError(error, target.timeoutMs) }
    }
  }

  return {
    async run(target: Target): Promise<ProbeResult> {
      let last: ProbeResult = { ok: false, error: 'chưa thực hiện lần thử nào' }
      for (let index = 0; index < Math.max(1, attempts); index++) {
        if (index > 0) await sleep(retryDelayMs)
        last = await attempt(target)
        if (last.ok) return last
      }
      return last
    },
  }
}
