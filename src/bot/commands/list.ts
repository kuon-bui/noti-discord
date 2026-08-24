import { SlashCommandBuilder } from 'discord.js'
import type { Target } from '../../shared/types.js'
import type { Command } from '../types.js'

const STATUS_ICON: Record<string, string> = {
  UP: '🟢',
  DEGRADED: '🟡',
  DOWN: '🔴',
  UNKNOWN: '⚪',
}

const MAX_REPLY_CONTENT = 2_000

function isPaused(target: Target, now: Date): boolean {
  return target.pausedUntil !== null && Date.parse(target.pausedUntil) > now.getTime()
}

function displayUrl(value: string): string {
  try {
    const parsed = new URL(value)
    const redactedSuffix = parsed.search || parsed.hash ? '?…' : ''
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${redactedSuffix}`
  } catch {
    return value
  }
}

function truncateReply(content: string): string {
  return content.length <= MAX_REPLY_CONTENT
    ? content
    : `${content.slice(0, MAX_REPLY_CONTENT - 1)}…`
}

export const listCommand: Command = {
  name: 'list',
  adminOnly: false,
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('Liệt kê mọi endpoint đang theo dõi'),

  async execute(context, interaction) {
    const now = context.clock()
    const all = context.targets.findAll()

    if (all.length === 0) {
      await interaction.reply({ content: 'Chưa có target nào. Dùng `/add` để thêm.' })
      return
    }

    const rows = all.map((target) => {
      const icon = STATUS_ICON[target.currentStatus] ?? '⚪'
      const tag = isPaused(target, now) ? ' (paused)' : ''
      return `${icon} ${target.name} — ${displayUrl(target.url)} — mỗi ${target.intervalSeconds}s${tag}`
    })

    await interaction.reply({
      content: truncateReply(`**${all.length} target đang theo dõi**\n${rows.join('\n')}`),
    })
  },
}
