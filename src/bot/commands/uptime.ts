import { SlashCommandBuilder } from 'discord.js'
import { buildDigest, type DigestInput } from '../../digest/digest.js'
import { formatDuration } from '../../shared/time.js'
import { EPHEMERAL, type Command } from '../types.js'

const RANGES: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1_000,
  '7d': 7 * 24 * 60 * 60 * 1_000,
  '30d': 30 * 24 * 60 * 60 * 1_000,
}

export const uptimeCommand: Command = {
  name: 'uptime',
  adminOnly: false,
  data: new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('Xem tỉ lệ uptime của một endpoint')
    .addStringOption((option) =>
      option.setName('name').setDescription('Tên target').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('range').setDescription('Khoảng thời gian').addChoices(
        { name: '24h', value: '24h' },
        { name: '7d', value: '7d' },
        { name: '30d', value: '30d' },
      ),
    ),

  async execute(context, interaction) {
    const name = interaction.options.getString('name')
    if (!name) {
      await interaction.reply({ content: '`name` là bắt buộc.', flags: EPHEMERAL })
      return
    }

    const rangeKey = interaction.options.getString('range') ?? '24h'
    const rangeMs = RANGES[rangeKey]
    if (rangeMs === undefined) {
      await interaction.reply({
        content: '`range` chỉ nhận `24h`, `7d` hoặc `30d`.',
        flags: EPHEMERAL,
      })
      return
    }

    const target = context.targets.findByName(name)
    if (!target) {
      await interaction.reply({ content: `Không tìm thấy target \`${name}\`.`, flags: EPHEMERAL })
      return
    }

    const now = context.clock()
    const nowIso = now.toISOString()
    const sinceIso = new Date(now.getTime() - rangeMs).toISOString()
    const input: DigestInput = {
      name: target.name,
      currentStatus: target.currentStatus,
      paused: target.pausedUntil !== null && Date.parse(target.pausedUntil) > now.getTime(),
      stats: context.checks.statsSince(target.id, sinceIso),
      incidents: context.incidents.listOverlapping(target.id, sinceIso),
    }

    const line = buildDigest([input], rangeKey, sinceIso, nowIso).lines[0]
    if (!line) {
      await interaction.reply({ content: `Không tính được uptime cho \`${name}\`.`, flags: EPHEMERAL })
      return
    }

    if (line.uptimePct === null) {
      await interaction.reply({ content: `\`${name}\` chưa có dữ liệu check nào trong ${rangeKey}.` })
      return
    }

    const latency = line.avgLatencyMs === null ? 'không có' : `${line.avgLatencyMs} ms`
    await interaction.reply({
      content: [
        `**Uptime \`${name}\` — ${rangeKey}**`,
        `Uptime: ${line.uptimePct}%`,
        `Latency trung bình: ${latency}`,
        `Số sự cố: ${line.incidentCount}`,
        `Tổng thời gian gián đoạn: ${formatDuration(line.downtimeMs)}`,
      ].join('\n'),
    })
  },
}
