import { SlashCommandBuilder } from 'discord.js'
import { formatDuration } from '../../shared/time.js'
import { EPHEMERAL, type Command } from '../types.js'

const LIMIT = 10
const MAX_REPLY_CONTENT = 2_000
const MAX_HISTORY_ROW = 1_800

function truncateText(content: string): string {
  return content.length <= MAX_HISTORY_ROW
    ? content
    : `${content.slice(0, MAX_HISTORY_ROW - 1)}…`
}

function paginate(name: string, rows: readonly string[]): string[] {
  const firstHeader = `**${rows.length} sự cố gần nhất của \`${name}\`**`
  const nextHeader = `**${rows.length} sự cố gần nhất của \`${name}\` (tiếp)**`
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

export const historyCommand: Command = {
  name: 'history',
  adminOnly: false,
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Xem các sự cố gần nhất của một endpoint')
    .addStringOption((option) =>
      option.setName('name').setDescription('Tên target').setRequired(true),
    ),

  async execute(context, interaction) {
    const name = interaction.options.getString('name')
    if (!name) {
      await interaction.reply({ content: '`name` là bắt buộc.', flags: EPHEMERAL })
      return
    }

    const target = context.targets.findByName(name)
    if (!target) {
      await interaction.reply({ content: `Không tìm thấy target \`${name}\`.`, flags: EPHEMERAL })
      return
    }

    const incidents = context.incidents.listRecent(target.id, LIMIT)
    if (incidents.length === 0) {
      await interaction.reply({ content: `\`${name}\` chưa có sự cố nào được ghi nhận.` })
      return
    }

    const nowMs = context.clock().getTime()
    const rows = incidents.map((incident) => {
      const endMs = incident.endedAt ? Date.parse(incident.endedAt) : nowMs
      const duration = formatDuration(endMs - Date.parse(incident.startedAt))
      const state = incident.endedAt ? duration : `${duration} — đang diễn ra`
      return truncateText(
        `• ${incident.startedAt} — ${state} — ${incident.reason ?? 'không rõ lý do'}`,
      )
    })

    const [firstPage, ...followingPages] = paginate(name, rows)
    await interaction.reply({ content: firstPage })
    for (const page of followingPages) {
      await interaction.followUp({ content: page })
    }
  },
}
