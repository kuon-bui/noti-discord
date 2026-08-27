import { SlashCommandBuilder } from 'discord.js'
import { redactUrlForDisplay } from '../../shared/url.js'
import { EPHEMERAL, type Command } from '../types.js'
import {
  ValidationError,
  validateChannel,
  validateName,
  validateRange,
  validateUrl,
} from '../validate.js'

export const addCommand: Command = {
  name: 'add',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('add')
    .setDescription('Thêm một endpoint vào danh sách theo dõi')
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('Tên ngắn, chữ thường và gạch ngang')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('url').setDescription('URL http/https cần kiểm tra').setRequired(true),
    )
    .addIntegerOption((option) =>
      option.setName('interval').setDescription('Chu kỳ check, tính bằng giây'),
    )
    .addIntegerOption((option) =>
      option.setName('timeout').setDescription('Timeout mỗi lần check, tính bằng ms'),
    )
    .addIntegerOption((option) =>
      option
        .setName('latency')
        .setDescription('Ngưỡng latency coi là DEGRADED, tính bằng ms'),
    )
    .addChannelOption((option) =>
      option.setName('channel').setDescription('Channel nhận alert riêng cho endpoint này'),
    ),

  async execute(context, interaction) {
    const rawName = interaction.options.getString('name')
    const rawUrl = interaction.options.getString('url')

    if (!rawName || !rawUrl) {
      await interaction.reply({ content: '`name` và `url` là bắt buộc.', flags: EPHEMERAL })
      return
    }

    try {
      const name = validateName(rawName)
      const url = validateUrl(rawUrl)
      const intervalSeconds = validateRange(
        'interval',
        interaction.options.getInteger('interval') ?? context.config.defaultIntervalSeconds,
        10,
        86_400,
      )
      const timeoutMs = validateRange(
        'timeout',
        interaction.options.getInteger('timeout') ?? context.config.defaultTimeoutMs,
        1_000,
        60_000,
      )
      const rawLatency = interaction.options.getInteger('latency')
      const latencyThresholdMs =
        rawLatency === null ? null : validateRange('latency', rawLatency, 1, 600_000)

      const channel = interaction.options.getChannel('channel')
      const alertChannelId = channel === null ? null : validateChannel(channel)

      if (context.targets.findByName(name)) {
        await interaction.reply({ content: `Target \`${name}\` đã tồn tại.`, flags: EPHEMERAL })
        return
      }

      const createdAt = context.clock().toISOString()
      const created = context.targets.create({
        name,
        url,
        intervalSeconds,
        timeoutMs,
        latencyThresholdMs,
        createdBy: interaction.user.id,
        createdAt,
      })

      if (alertChannelId !== null) {
        context.destinations.add({
          targetId: created.id,
          provider: 'discord',
          address: alertChannelId,
          createdAt,
        })
      }

      await interaction.reply({
        content: `Đã thêm \`${name}\` → ${redactUrlForDisplay(url)} (mỗi ${intervalSeconds}s, timeout ${timeoutMs}ms).`,
      })
    } catch (error) {
      if (error instanceof ValidationError) {
        await interaction.reply({ content: error.message, flags: EPHEMERAL })
        return
      }
      throw error
    }
  },
}
