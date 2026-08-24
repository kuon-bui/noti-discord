import type { AppConfig } from '../config.js'
import type { ChecksRepo } from '../db/checks.repo.js'
import type { IncidentsRepo } from '../db/incidents.repo.js'
import type { TargetsRepo } from '../db/targets.repo.js'
import type { Runner } from '../monitor/runner.js'
import type { Logger } from '../shared/logger.js'
import type { Clock } from '../shared/time.js'

/** Bằng MessageFlags.Ephemeral của discord.js (1 << 6). */
export const EPHEMERAL = 64

/** Bằng ChannelType.GuildText của discord.js. */
export const CHANNEL_TYPE_GUILD_TEXT = 0

export type InteractionReply = {
  content?: string
  embeds?: unknown[]
  flags?: number
}

export type ChannelOption = { id: string; type: number }

export type InteractionLike = {
  commandName: string
  user: { id: string }
  options: {
    getString(name: string): string | null
    getInteger(name: string): number | null
    getChannel(name: string): ChannelOption | null
  }
  reply(payload: InteractionReply): Promise<unknown>
  followUp(payload: InteractionReply): Promise<unknown>
  deferReply(payload?: InteractionReply): Promise<unknown>
  editReply(payload: InteractionReply): Promise<unknown>
}

export type CommandContext = {
  targets: TargetsRepo
  checks: ChecksRepo
  incidents: IncidentsRepo
  runner: Runner
  config: AppConfig
  clock: Clock
  logger: Logger
}

export type Command = {
  name: string
  data: { name: string; toJSON(): unknown }
  adminOnly: boolean
  execute(context: CommandContext, interaction: InteractionLike): Promise<void>
}
