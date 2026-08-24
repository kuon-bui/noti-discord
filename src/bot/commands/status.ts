import { SlashCommandBuilder } from 'discord.js'
import type { Target } from '../../shared/types.js'
import { EPHEMERAL, type Command, type CommandContext } from '../types.js'

const STATUS_ICON: Record<string, string> = {
  UP: '🟢',
  DEGRADED: '🟡',
  DOWN: '🔴',
  UNKNOWN: '⚪',
}

const MAX_REPLY_CONTENT = 2_000
const MAX_STATUS_LINE = 1_800

function truncateText(content: string): string {
  return content.length <= MAX_STATUS_LINE
    ? content
    : `${content.slice(0, MAX_STATUS_LINE - 1)}…`
}

function lineFor(context: CommandContext, target: Target): string {
  const icon = STATUS_ICON[target.currentStatus] ?? '⚪'
  const last = context.checks.listRecent(target.id, 1)[0]

  if (!last) {
    return `${icon} **${target.name}** — ${target.currentStatus} — chưa check lần nào`
  }

  const latency = last.latencyMs == null ? 'không đo được' : `${last.latencyMs} ms`
  const detail = last.error ?? `HTTP ${last.httpStatus ?? '?'}`
  return truncateText(
    `${icon} **${target.name}** — ${target.currentStatus} — ${latency} — ${detail} — lúc ${last.checkedAt}`,
  )
}

function paginate(lines: readonly string[]): string[] {
  const pages: string[] = []
  let page = ''

  for (const line of lines) {
    const candidate = page ? `${page}\n${line}` : line
    if (candidate.length <= MAX_REPLY_CONTENT) {
      page = candidate
      continue
    }

    pages.push(page)
    page = line
  }

  if (page) pages.push(page)
  return pages
}

export const statusCommand: Command = {
  name: 'status',
  adminOnly: false,
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Xem trạng thái hiện tại của endpoint')
    .addStringOption((option) => option.setName('name').setDescription('Chỉ xem một target')),

  async execute(context, interaction) {
    const name = interaction.options.getString('name')

    if (name) {
      const target = context.targets.findByName(name)
      if (!target) {
        await interaction.reply({ content: `Không tìm thấy target \`${name}\`.`, flags: EPHEMERAL })
        return
      }
      await interaction.reply({ content: lineFor(context, target) })
      return
    }

    const all = context.targets.findAll()
    if (all.length === 0) {
      await interaction.reply({ content: 'Chưa có target nào. Dùng `/add` để thêm.' })
      return
    }

    const [firstPage, ...followingPages] = paginate(all.map((target) => lineFor(context, target)))
    await interaction.reply({ content: firstPage })
    for (const page of followingPages) {
      await interaction.followUp({ content: page })
    }
  },
}
