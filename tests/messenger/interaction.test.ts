import { beforeEach, describe, expect, it } from 'bun:test'
import { addCommand } from '../../src/bot/commands/add.js'
import { statusCommand } from '../../src/bot/commands/status.js'
import type { CommandContext } from '../../src/bot/types.js'
import { openTestDb } from '../../src/db/connection.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { makeMessengerInteraction } from '../../src/messenger/interaction.js'
import { makeTestContext, TEST_NOW } from '../helpers/context.js'

function harness(
  commandName: string,
  strings: Record<string, string> = {},
  integers: Record<string, number> = {},
) {
  const sent: string[] = []
  let typingCount = 0
  const interaction = makeMessengerInteraction({
    commandName,
    psid: 'psid-1',
    strings: new Map(Object.entries(strings)),
    integers: new Map(Object.entries(integers)),
    send: async (texts) => {
      sent.push(...texts)
    },
    typing: async () => {
      typingCount += 1
    },
  })
  return { interaction, sent, typing: () => typingCount }
}

let context: CommandContext

beforeEach(async () => {
  const { db } = openTestDb()
  await applyMigrations(db)
  context = makeTestContext(db)
})

describe('makeMessengerInteraction', () => {
  it('khớp hình dạng InteractionLike', () => {
    const { interaction } = harness('status')
    expect(interaction.commandName).toBe('status')
    expect(interaction.user.id).toBe('psid-1')
    expect(interaction.options.getChannel('channel')).toBeNull()
  })

  it('getString và getInteger đọc từ map, thiếu thì null', () => {
    const { interaction } = harness('add', { name: 'api' }, { interval: 30 })
    expect(interaction.options.getString('name')).toBe('api')
    expect(interaction.options.getString('url')).toBeNull()
    expect(interaction.options.getInteger('interval')).toBe(30)
    expect(interaction.options.getInteger('timeout')).toBeNull()
  })

  it('deferReply gửi typing chứ không gửi tin', async () => {
    const { interaction, sent, typing } = harness('check')
    await interaction.deferReply()
    expect(typing()).toBe(1)
    expect(sent).toEqual([])
  })

  it('bỏ markdown Discord khỏi content', async () => {
    const { interaction, sent } = harness('status')
    await interaction.reply({ content: '**web** — `UP`' })
    expect(sent).toEqual(['web — UP'])
  })

  it('bỏ qua flag EPHEMERAL thay vì làm hỏng tin', async () => {
    const { interaction, sent } = harness('status')
    await interaction.reply({ content: 'riêng tư', flags: 64 })
    expect(sent).toEqual(['riêng tư'])
  })

  it('render được embeds — cả EmbedBuilder lẫn APIEmbed thuần', async () => {
    const { interaction, sent } = harness('check')
    await interaction.editReply({
      embeds: [
        { toJSON: () => ({ title: 'từ builder', description: 'd1' }) },
        { title: 'thuần', description: 'd2' },
      ],
    })
    expect(sent.join('\n')).toContain('từ builder')
    expect(sent.join('\n')).toContain('thuần')
  })

  it('payload rỗng thì không gửi gì', async () => {
    const { interaction, sent } = harness('status')
    await interaction.reply({})
    expect(sent).toEqual([])
  })

  it('chạy thật statusCommand qua adapter', async () => {
    context.targets.create({
      name: 'web',
      url: 'https://a.test',
      intervalSeconds: 60,
      timeoutMs: 10_000,
      createdBy: 'u1',
      createdAt: TEST_NOW,
    })
    const { interaction, sent } = harness('status')
    await statusCommand.execute(context, interaction)

    expect(sent.join('\n')).toContain('web')
    expect(sent.join('\n')).not.toContain('**')
  })

  it('chạy thật addCommand qua adapter, không có channel', async () => {
    const { interaction, sent } = harness('add', { name: 'api', url: 'https://b.test' })
    await addCommand.execute(context, interaction)

    const target = context.targets.findByName('api')
    expect(target?.url).toBe('https://b.test')
    expect(target?.createdBy).toBe('psid-1')
    expect(context.destinations.listForTarget(target!.id)).toEqual([])
    expect(sent.join('\n')).toContain('api')
  })
})
