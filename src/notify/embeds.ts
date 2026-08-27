import { EmbedBuilder } from 'discord.js'
import type { AlertMessage } from '../shared/types.js'

const MAX_TITLE = 256
const MAX_DESCRIPTION = 4_096
const MAX_FIELD_VALUE = 1_024
const MAX_FIELDS = 25
const MAX_TOTAL = 6_000

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

const EMPTY_TABLE = 'Chưa có target nào được theo dõi.'

function digestTableText(rows: readonly string[][]): string {
  if (rows.length === 0) return EMPTY_TABLE
  return rows
    .map((cells) => {
      const [icon = '', name = '', uptime = '', latency = '', incidents = '', downtime = ''] =
        cells
      return `${icon} ${name.padEnd(16)}${uptime.padStart(14)}  ${latency.padStart(8)}  ${incidents.padStart(3)} sự cố  ${downtime}`
    })
    .join('\n')
}

export function toEmbed(message: AlertMessage): EmbedBuilder {
  const tableBlock = message.table ? `\`\`\`\n${digestTableText(message.table.rows)}\n\`\`\`` : ''
  const combined = [message.description, tableBlock].filter((part) => part.length > 0).join('\n')
  const title = truncate(message.title, MAX_TITLE)
  const description = truncate(combined, MAX_DESCRIPTION)
  let remaining = MAX_TOTAL - title.length - description.length

  const fields = [] as Array<{ name: string; value: string; inline: boolean }>
  for (const field of message.fields.slice(0, MAX_FIELDS)) {
    // A Discord field needs at least one character for both name and value.
    if (remaining < 2) break

    const name = truncate(field.name, Math.min(MAX_TITLE, remaining - 1))
    const valueBudget = Math.min(MAX_FIELD_VALUE, remaining - name.length)
    if (valueBudget < 1) break

    const value = truncate(field.value, valueBudget)
    fields.push({ name, value, inline: field.inline ?? false })
    remaining -= name.length + value.length
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(message.color)
    .setTimestamp(new Date(message.timestampIso))

  if (description.length > 0) embed.setDescription(description)
  if (fields.length > 0) embed.addFields(fields)

  return embed
}
