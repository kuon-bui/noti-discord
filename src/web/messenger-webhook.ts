import { Elysia } from 'elysia'
import { verifySignature } from './signature.js'
import type { Logger } from '../shared/logger.js'

export type MessengerWebhookDeps = {
  path: string
  verifyToken: string
  appSecret: string
  logger: Logger
  handleEvent(payload: unknown): Promise<void>
}

export function makeMessengerWebhook(deps: MessengerWebhookDeps): Elysia {
  const app = new Elysia()

  app.get(deps.path, ({ query }) => {
    const mode = query['hub.mode']
    const challenge = query['hub.challenge']
    const token = query['hub.verify_token']

    if (mode !== 'subscribe' || !challenge || token !== deps.verifyToken) {
      return new Response('', { status: 403 })
    }

    return new Response(challenge)
  })

  app.post(deps.path, async ({ request, body }) => {
    const signature = request.headers.get('x-hub-signature-256') ?? undefined
    const raw = new TextEncoder().encode(JSON.stringify(body))

    if (!verifySignature(raw, signature, deps.appSecret)) {
      return new Response('', { status: 403 })
    }

    try {
      await deps.handleEvent(body)
    } catch (error) {
      deps.logger.error('Xử lý webhook Messenger thất bại', error)
    }

    return new Response('', { status: 200 })
  })

  return app
}
