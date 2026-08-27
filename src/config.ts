import { z } from 'zod'
import type { LogLevel } from './shared/logger.js'

const schema = z
  .object({
    DISCORD_TOKEN: z.string().min(1),
    DISCORD_CLIENT_ID: z.string().min(1),
    GUILD_ID: z.string().min(1),
    DEFAULT_ALERT_CHANNEL_ID: z.string().min(1),
    DIGEST_CHANNEL_ID: z.string().min(1),
    ADMIN_USER_IDS: z.string().min(1),

    DB_PATH: z.string().min(1).default('./data/monitor.db'),
    DIGEST_HOUR_LOCAL: z.coerce.number().int().min(0).max(23).default(9),
    DEFAULT_INTERVAL_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
    DEFAULT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
    DEFAULT_LATENCY_THRESHOLD_MS: z.coerce.number().int().positive().default(2_000),
    CHECK_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    MAX_CONCURRENT_CHECKS: z.coerce.number().int().min(1).max(50).default(5),
    TICK_INTERVAL_MS: z.coerce.number().int().min(1_000).default(10_000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    MESSENGER_ENABLED: z.enum(['true', 'false']).default('false'),
    MESSENGER_PAGE_ACCESS_TOKEN: z.string().default(''),
    MESSENGER_APP_SECRET: z.string().default(''),
    MESSENGER_VERIFY_TOKEN: z.string().default(''),
    MESSENGER_PORT: z.coerce.number().int().min(1).max(65_535).default(8_080),
    MESSENGER_WEBHOOK_PATH: z
      .string()
      .min(1)
      .refine((v) => v.startsWith('/'), 'phải bắt đầu bằng /')
      .default('/webhook/messenger'),
    MESSENGER_API_VERSION: z.string().min(1).default('v21.0'),
    MESSENGER_OUTBOX_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(720).default(48),
  })
  .superRefine((raw, ctx) => {
    if (raw.MESSENGER_ENABLED !== 'true') return
    const required = [
      'MESSENGER_PAGE_ACCESS_TOKEN',
      'MESSENGER_APP_SECRET',
      'MESSENGER_VERIFY_TOKEN',
    ] as const
    for (const key of required) {
      if (raw[key].length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'bắt buộc khi MESSENGER_ENABLED=true',
        })
      }
    }
  })

export type MessengerConfig = Readonly<{
  pageAccessToken: string
  appSecret: string
  verifyToken: string
  port: number
  webhookPath: string
  apiVersion: string
  outboxMaxAgeHours: number
}>

export type AppConfig = Readonly<{
  discordToken: string
  discordClientId: string
  guildId: string
  defaultAlertChannelId: string
  digestChannelId: string
  adminUserIds: readonly string[]
  dbPath: string
  digestHourLocal: number
  defaultIntervalSeconds: number
  defaultTimeoutMs: number
  defaultLatencyThresholdMs: number
  checkRetentionDays: number
  maxConcurrentChecks: number
  tickIntervalMs: number
  logLevel: LogLevel
  messenger: MessengerConfig | null
}>

function formatIssues(error: z.ZodError): string {
  const lines = error.issues.map((i) => `  - ${i.path.join('.') || '(gốc)'}: ${i.message}`)
  return `Cấu hình không hợp lệ:\n${lines.join('\n')}`
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env)
  if (!parsed.success) throw new Error(formatIssues(parsed.error))

  const raw = parsed.data
  const adminUserIds = raw.ADMIN_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean)
  if (adminUserIds.length === 0) {
    throw new Error('Cấu hình không hợp lệ:\n  - ADMIN_USER_IDS: phải có ít nhất một user ID')
  }

  const messenger: MessengerConfig | null =
    raw.MESSENGER_ENABLED === 'true'
      ? Object.freeze({
          pageAccessToken: raw.MESSENGER_PAGE_ACCESS_TOKEN,
          appSecret: raw.MESSENGER_APP_SECRET,
          verifyToken: raw.MESSENGER_VERIFY_TOKEN,
          port: raw.MESSENGER_PORT,
          webhookPath: raw.MESSENGER_WEBHOOK_PATH,
          apiVersion: raw.MESSENGER_API_VERSION,
          outboxMaxAgeHours: raw.MESSENGER_OUTBOX_MAX_AGE_HOURS,
        })
      : null

  return Object.freeze({
    discordToken: raw.DISCORD_TOKEN,
    discordClientId: raw.DISCORD_CLIENT_ID,
    guildId: raw.GUILD_ID,
    defaultAlertChannelId: raw.DEFAULT_ALERT_CHANNEL_ID,
    digestChannelId: raw.DIGEST_CHANNEL_ID,
    adminUserIds: Object.freeze(adminUserIds),
    dbPath: raw.DB_PATH,
    digestHourLocal: raw.DIGEST_HOUR_LOCAL,
    defaultIntervalSeconds: raw.DEFAULT_INTERVAL_SECONDS,
    defaultTimeoutMs: raw.DEFAULT_TIMEOUT_MS,
    defaultLatencyThresholdMs: raw.DEFAULT_LATENCY_THRESHOLD_MS,
    checkRetentionDays: raw.CHECK_RETENTION_DAYS,
    maxConcurrentChecks: raw.MAX_CONCURRENT_CHECKS,
    tickIntervalMs: raw.TICK_INTERVAL_MS,
    logLevel: raw.LOG_LEVEL,
    messenger,
  })
}
