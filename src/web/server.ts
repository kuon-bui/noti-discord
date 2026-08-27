import type { Elysia } from 'elysia'
import type { Logger } from '../shared/logger.js'

export type WebServer = {
  stop(): Promise<void>
}

export type WebServerDeps = {
  port: number
  webhook: Elysia
  logger: Logger
}

export async function startWebServer(deps: WebServerDeps): Promise<WebServer> {
  const server = deps.webhook.listen(deps.port)
  deps.logger.info(`HTTP server listening on port ${deps.port}`)

  return {
    async stop() {
      await server.stop()
      deps.logger.info(`HTTP server stopped`)
    },
  }
}
