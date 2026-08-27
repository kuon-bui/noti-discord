import { SlashCommandBuilder } from 'discord.js'
import { EPHEMERAL, type Command } from '../types.js'

export const messengerUnlinkCommand: Command = {
  name: 'messenger-unlink',
  adminOnly: false,
  data: new SlashCommandBuilder()
    .setName('messenger-unlink')
    .setDescription('Huỷ liên kết với Messenger'),

  async execute(context, interaction) {
    const psid = context.messenger.findPsidByDiscordUserId(interaction.user.id)

    if (psid === null) {
      await interaction.reply({
        content: 'Bạn chưa liên kết với Messenger.',
        flags: EPHEMERAL,
      })
      return
    }

    context.messenger.unlink(psid)
    await interaction.reply({
      content: 'Đã huỷ liên kết với Messenger.',
      flags: EPHEMERAL,
    })
  },
}
