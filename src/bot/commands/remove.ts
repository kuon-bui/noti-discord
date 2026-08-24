import { SlashCommandBuilder } from 'discord.js'
import { EPHEMERAL, type Command } from '../types.js'

export const removeCommand: Command = {
  name: 'remove',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Bỏ một endpoint khỏi danh sách theo dõi')
    .addStringOption((option) =>
      option.setName('name').setDescription('Tên target cần xoá').setRequired(true),
    ),

  async execute(context, interaction) {
    const name = interaction.options.getString('name')
    if (!name) {
      await interaction.reply({ content: '`name` là bắt buộc.', flags: EPHEMERAL })
      return
    }

    const removed = context.targets.remove(name)
    await interaction.reply({
      content: removed
        ? `Đã xoá \`${name}\` cùng toàn bộ lịch sử check và sự cố của nó.`
        : `Không tìm thấy target \`${name}\`.`,
      flags: removed ? undefined : EPHEMERAL,
    })
  },
}
