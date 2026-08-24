import { SlashCommandBuilder } from 'discord.js'
import { toEmbed } from '../../notify/embeds.js'
import { manualCheckMessage } from '../../notify/messages.js'
import { EPHEMERAL, type Command } from '../types.js'

export const checkCommand: Command = {
  name: 'check',
  adminOnly: false,
  data: new SlashCommandBuilder()
    .setName('check')
    .setDescription('Chạy kiểm tra ngay, không chờ tới chu kỳ')
    .addStringOption((option) =>
      option.setName('name').setDescription('Tên target').setRequired(true),
    ),

  async execute(context, interaction) {
    const name = interaction.options.getString('name')
    if (!name) {
      await interaction.reply({ content: '`name` là bắt buộc.', flags: EPHEMERAL })
      return
    }

    // Một lần probe có thể mất tới timeout cộng một lần retry, vượt hạn 3s của Discord.
    await interaction.deferReply()

    try {
      const outcome = await context.runner.checkByName(name)
      if (!outcome) {
        await interaction.editReply({ content: `Không tìm thấy target \`${name}\`.` })
        return
      }

      const message = manualCheckMessage(outcome, context.clock().toISOString())
      await interaction.editReply({ embeds: [toEmbed(message)] })
    } catch (error) {
      context.logger.error('Lệnh /check thất bại', error)
      await interaction.editReply({
        content: 'Đã có lỗi khi chạy kiểm tra. Xem log của bot để biết chi tiết.',
      })
    }
  },
}
