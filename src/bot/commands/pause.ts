import { SlashCommandBuilder } from 'discord.js'
import { ValidationError, validateRange } from '../validate.js'
import { EPHEMERAL, type Command } from '../types.js'

const FOREVER_ISO = '9999-12-31T23:59:59.000Z'

export const pauseCommand: Command = {
  name: 'pause',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Tạm dừng theo dõi một endpoint')
    .addStringOption((option) =>
      option.setName('name').setDescription('Tên target').setRequired(true),
    )
    .addIntegerOption((option) =>
      option.setName('minutes').setDescription('Số phút tạm dừng; bỏ trống là vô hạn'),
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

    const rawMinutes = interaction.options.getInteger('minutes')
    try {
      if (rawMinutes === null) {
        context.targets.setPause(target.id, FOREVER_ISO)
        await interaction.reply({
          content: `Đã tạm dừng \`${name}\` vô hạn. Dùng \`/resume\` để bật lại.`,
        })
        return
      }

      const minutes = validateRange('minutes', rawMinutes, 1, 43_200)
      const until = new Date(context.clock().getTime() + minutes * 60_000).toISOString()
      context.targets.setPause(target.id, until)
      await interaction.reply({
        content: `Đã tạm dừng \`${name}\` trong ${minutes} phút, tới ${until}.`,
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

export const resumeCommand: Command = {
  name: 'resume',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Bật lại theo dõi một endpoint đang tạm dừng')
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

    context.targets.setPause(target.id, null)
    await interaction.reply({ content: `Đã bật lại theo dõi \`${name}\`.` })
  },
}
