import { SlashCommandBuilder } from 'discord.js'
import { isProviderName, PROVIDER_NAMES } from '../../notify/notifier.js'
import { EPHEMERAL, type Command, type CommandContext, type InteractionLike } from '../types.js'

const PROVIDER_LIST = PROVIDER_NAMES.join(', ')
const PROVIDER_CHOICES = PROVIDER_NAMES.map((p) => ({ name: p, value: p }))

type Resolved =
  | { ok: true; targetId: number | null; label: string }
  | { ok: false; message: string }

function resolveTarget(context: CommandContext, name: string | null): Resolved {
  if (name === null) return { ok: true, targetId: null, label: 'toàn cục' }
  const target = context.targets.findByName(name)
  if (!target) return { ok: false, message: `Không tìm thấy target \`${name}\`.` }
  return { ok: true, targetId: target.id, label: `\`${name}\`` }
}

/** Trả về provider đã hợp lệ, hoặc null sau khi đã trả lời lỗi cho người dùng. */
async function readProvider(interaction: InteractionLike): Promise<'discord' | 'messenger' | null> {
  const provider = interaction.options.getString('provider')
  const address = interaction.options.getString('address')

  if (!provider || !address) {
    await interaction.reply({ content: '`provider` và `address` là bắt buộc.', flags: EPHEMERAL })
    return null
  }
  if (!isProviderName(provider)) {
    await interaction.reply({
      content: `provider phải là một trong: ${PROVIDER_LIST}.`,
      flags: EPHEMERAL,
    })
    return null
  }
  return provider
}

export const destAddCommand: Command = {
  name: 'dest-add',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('dest-add')
    .setDescription('Thêm nơi nhận alert')
    .addStringOption((o) =>
      o
        .setName('provider')
        .setDescription(`Một trong: ${PROVIDER_LIST}`)
        .setRequired(true)
        .addChoices(...PROVIDER_CHOICES),
    )
    .addStringOption((o) =>
      o
        .setName('address')
        .setDescription('Channel ID với discord, PSID với messenger')
        .setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('name').setDescription('Gắn riêng cho một target; bỏ trống là toàn cục'),
    ),

  async execute(context, interaction) {
    const provider = await readProvider(interaction)
    if (provider === null) return

    const address = interaction.options.getString('address') as string
    const resolved = resolveTarget(context, interaction.options.getString('name'))
    if (!resolved.ok) {
      await interaction.reply({ content: resolved.message, flags: EPHEMERAL })
      return
    }

    const added = context.destinations.add({
      targetId: resolved.targetId,
      provider,
      address,
      createdAt: context.clock().toISOString(),
    })

    await interaction.reply({
      content: added
        ? `Đã thêm ${provider} → \`${address}\` cho ${resolved.label}.`
        : `Destination ${provider} → \`${address}\` cho ${resolved.label} đã tồn tại.`,
    })
  },
}

export const destRemoveCommand: Command = {
  name: 'dest-remove',
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('dest-remove')
    .setDescription('Bỏ một nơi nhận alert')
    .addStringOption((o) =>
      o
        .setName('provider')
        .setDescription(`Một trong: ${PROVIDER_LIST}`)
        .setRequired(true)
        .addChoices(...PROVIDER_CHOICES),
    )
    .addStringOption((o) => o.setName('address').setDescription('Địa chỉ cần bỏ').setRequired(true))
    .addStringOption((o) =>
      o.setName('name').setDescription('Target tương ứng; bỏ trống là toàn cục'),
    ),

  async execute(context, interaction) {
    const provider = await readProvider(interaction)
    if (provider === null) return

    const address = interaction.options.getString('address') as string
    const resolved = resolveTarget(context, interaction.options.getString('name'))
    if (!resolved.ok) {
      await interaction.reply({ content: resolved.message, flags: EPHEMERAL })
      return
    }

    const removed = context.destinations.remove(resolved.targetId, provider, address)
    if (!removed) {
      await interaction.reply({
        content: `Không tìm thấy destination ${provider} → \`${address}\` ở ${resolved.label}.`,
        flags: EPHEMERAL,
      })
      return
    }

    await interaction.reply({
      content: `Đã bỏ ${provider} → \`${address}\` khỏi ${resolved.label}.`,
    })
  },
}

export const destListCommand: Command = {
  name: 'dest-list',
  adminOnly: false,
  data: new SlashCommandBuilder()
    .setName('dest-list')
    .setDescription('Xem nơi nhận alert')
    .addStringOption((o) =>
      o.setName('name').setDescription('Chỉ xem của một target; bỏ trống là toàn cục'),
    ),

  async execute(context, interaction) {
    const resolved = resolveTarget(context, interaction.options.getString('name'))
    if (!resolved.ok) {
      await interaction.reply({ content: resolved.message, flags: EPHEMERAL })
      return
    }

    const rows =
      resolved.targetId === null
        ? context.destinations.listGlobal()
        : context.destinations.listForTarget(resolved.targetId)

    if (rows.length === 0) {
      await interaction.reply({ content: `Chưa có destination nào cho ${resolved.label}.` })
      return
    }

    const lines = rows.map((row) => `• ${row.provider} → \`${row.address}\``)
    await interaction.reply({
      content: `**Destination của ${resolved.label}**\n${lines.join('\n')}`,
    })
  },
}
