import { randomBytes } from 'node:crypto'
import { SlashCommandBuilder } from 'discord.js'
import { EPHEMERAL, type Command } from '../types.js'

const CODE_LENGTH = 4
const VALIDITY_MINUTES = 10

function generateCode(): string {
  return randomBytes(CODE_LENGTH).toString('hex').toUpperCase()
}

export const messengerLinkCommand: Command = {
  name: 'messenger-link',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('messenger-link')
    .setDescription('Tạo mã để liên kết Messenger'),

  async execute(context, interaction) {
    const code = generateCode()
    const expiresAt = new Date(context.clock().getTime() + VALIDITY_MINUTES * 60 * 1_000)

    context.messenger.createLinkCode({
      code,
      discordUserId: interaction.user.id,
      expiresAtIso: expiresAt.toISOString(),
    })

    const message = `Mã liên kết: \`${code}\`\n\nGửi mã này vào Messenger bot trong ${VALIDITY_MINUTES} phút.`
    await interaction.reply({ content: message, flags: EPHEMERAL })
  },
}
