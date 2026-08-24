import { SlashCommandBuilder } from 'discord.js'
import type { Target } from '../../shared/types.js'
import { redactUrlForDisplay } from '../../shared/url.js'
import type { Command } from '../types.js'

const STATUS_ICON: Record<string, string> = {
  UP: '🟢',
  DEGRADED: '🟡',
  DOWN: '🔴',
  UNKNOWN: '⚪',
}

const MAX_REPLY_CONTENT = 2_000
const MAX_ROW_CONTENT = 1_800

function isPaused(target: Target, now: Date): boolean {
  return target.pausedUntil !== null && Date.parse(target.pausedUntil) > now.getTime()
}

function truncateText(content: string, maxLength: number): string {
  return content.length <= maxLength
    ? content
    : `${content.slice(0, maxLength - 1)}…`
}

function paginateRows(total: number, rows: readonly string[]): string[] {
  const firstHeader = `**${total} target đang theo dõi**`
  const nextHeader = `**${total} target đang theo dõi (tiếp)**`
  const pages: string[] = []
  let page = firstHeader

  for (const row of rows) {
    const candidate = `${page}\n${row}`
    if (candidate.length <= MAX_REPLY_CONTENT) {
      page = candidate
      continue
    }

    pages.push(page)
    page = `${nextHeader}\n${row}`
  }

  pages.push(page)
  return pages
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
      return truncateText(
        `${icon} ${target.name} — ${redactUrlForDisplay(target.url)} — mỗi ${target.intervalSeconds}s${tag}`,
        MAX_ROW_CONTENT,
      )
    })

    const [firstPage, ...followingPages] = paginateRows(all.length, rows)
    await interaction.reply({ content: firstPage })
    for (const page of followingPages) {
      await interaction.followUp({ content: page })
    }
  },
}
