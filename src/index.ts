import fs from 'node:fs'
import { Events } from 'discord.js'
import { createClient } from './bot/client.js'
import { allCommands } from './bot/commands/index.js'
import { makeRouter } from './bot/router.js'
import { isAdmin } from './bot/permissions.js'
import type { InteractionLike } from './bot/types.js'
import { loadConfig } from './config.js'
import { makeChecksRepo } from './db/checks.repo.js'
import { openDb } from './db/connection.js'
import { makeDestinationsRepo } from './db/destinations.repo.js'
import { makeIncidentsRepo } from './db/incidents.repo.js'
import { makeMessengerRepo } from './db/messenger.repo.js'
import { makeMetaRepo } from './db/meta.repo.js'
import {
  applyMigrations,
  backupDbFile,
  hasPendingMigrations,
  pruneBackups,
} from './db/migrate.js'
import { makeTargetsRepo } from './db/targets.repo.js'
import { makeDigestJob } from './digest/schedule.js'
import { makeHttpProbe } from './monitor/http-probe.js'
import { makeRunner } from './monitor/runner.js'
import { makeScheduler } from './monitor/scheduler.js'
import { makeDiscordNotifier } from './notify/discord-notifier.js'
import { makeDispatcher } from './notify/dispatcher.js'
import { makeMessengerClient } from './notify/messenger-client.js'
import { makeMessengerFlusher } from './notify/messenger-flush.js'
import { makeRouting } from './notify/routing.js'
import { makeMessengerEventHandler } from './messenger/handle-event.js'
import { makeMessengerWebhook } from './web/messenger-webhook.js'
import { startWebServer } from './web/server.js'
import { makeLogger } from './shared/logger.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const logger = makeLogger(config.logLevel)
  const clock = () => new Date()

  const dbExisted = config.dbPath !== ':memory:' && fs.existsSync(config.dbPath)
  if (config.dbPath !== ':memory:') {
    pruneBackups(config.dbPath)
  }

  const { raw, db } = openDb(config.dbPath)
  if (dbExisted && hasPendingMigrations(raw)) {
    raw.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const backup = backupDbFile(config.dbPath, clock())
    if (backup) logger.info(`Đã backup DB trước migration sang ${backup}`)
  }
  await applyMigrations(db)
  logger.info(`DB đã sẵn sàng tại ${config.dbPath}`)

  const targets = makeTargetsRepo(db)
  const checks = makeChecksRepo(db)
  const incidents = makeIncidentsRepo(db)
  const meta = makeMetaRepo(db)
  const destinations = makeDestinationsRepo(db)
  const messenger = makeMessengerRepo(db)

  const cutoffIso = new Date(
    clock().getTime() - config.checkRetentionDays * 24 * 60 * 60 * 1_000,
  ).toISOString()
  const removed = checks.deleteOlderThan(cutoffIso)
  if (removed > 0) logger.info(`Đã dọn ${removed} dòng checks cũ hơn ${cutoffIso}`)

  const client = createClient()
  const dispatcher = makeDispatcher({
    notifiers: [makeDiscordNotifier({ client, logger })],
    logger,
  })

  const messengerClient = config.messenger
    ? makeMessengerClient({
        accessToken: config.messenger.pageAccessToken,
        logger,
      })
    : null

  const messengerFlusher = config.messenger && messengerClient
    ? makeMessengerFlusher({
        messenger: messengerClient,
        outbox: destinations.listByProvider('messenger'),
        clock,
        logger,
      })
    : null

  const routing = makeRouting({
    destinations,
    config,
    messengerAdminPsids: () => messenger.adminPsids(),
  })
  const runner = makeRunner({
    probe: makeHttpProbe(),
    targets,
    checks,
    incidents,
    dispatcher,
    routing,
    config,
    clock,
    logger,
  })
  const digestJob = makeDigestJob({
    targets,
    checks,
    incidents,
    meta,
    dispatcher,
    routing,
    config,
    clock,
    logger,
  })
  const scheduler = makeScheduler({
    targets,
    runner,
    config,
    clock,
    logger,
    onTickDone: async () => {
      const result = await digestJob.maybeSend()
      if (result.sent) logger.info('Đã gửi digest hằng ngày')
    },
  })

  let messengerRouter: any = null
  let messengerEventHandler: any = null
  let webServer: any = null

  if (config.messenger && messengerClient && messengerFlusher) {
    messengerRouter = makeRouter({
      commands: allCommands(),
      ctx: { targets, checks, incidents, destinations, messenger, runner, config, clock, logger },
      isAdmin: (userId) => messenger.findIdentity(userId)?.isAdmin === true,
      logger,
    })

    messengerEventHandler = makeMessengerEventHandler({
      messenger,
      destinations,
      flusher: messengerFlusher,
      client: messengerClient,
      router: messengerRouter,
      commands: allCommands(),
      adminUserIds: config.adminUserIds,
      clock,
      logger,
    })

    const messengerWebhook = makeMessengerWebhook({
      path: config.messenger.webhookPath,
      verifyToken: config.messenger.verifyToken,
      appSecret: config.messenger.appSecret,
      logger,
      handleEvent: (payload) => messengerEventHandler.handle(payload),
    })

    webServer = await startWebServer({
      port: config.messenger.port,
      webhook: messengerWebhook,
      logger,
    })
  }

  const router = makeRouter({
    commands: allCommands(),
    ctx: { targets, checks, incidents, destinations, messenger, runner, config, clock, logger },
    isAdmin: (userId) => isAdmin(userId, config),
    logger,
  })

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return
    void router.handle(interaction as unknown as InteractionLike)
  })

  client.once(Events.ClientReady, (ready) => {
    logger.info(`Đã đăng nhập với tư cách ${ready.user.tag}`)
    scheduler.start()
    logger.info(`Scheduler chạy mỗi ${config.tickIntervalMs}ms`)
  })

  process.on('unhandledRejection', (error) => {
    logger.error('Promise bị reject mà không ai bắt', error)
  })
  process.on('uncaughtException', (error) => {
    logger.error('Ngoại lệ không ai bắt', error)
  })

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`Nhận ${signal}, đang tắt`)
    scheduler.stop()
    if (webServer) await webServer.stop()
    await client.destroy()
    raw.close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await client.login(config.discordToken)
}

main().catch((error) => {
  console.error('Khởi động thất bại:', error)
  process.exit(1)
})
