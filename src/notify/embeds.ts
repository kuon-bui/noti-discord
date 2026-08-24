import { EmbedBuilder } from 'discord.js'
import type { AlertMessage } from '../shared/types.js'

const MAX_TITLE = 256
const MAX_DESCRIPTION = 4_096
const MAX_FIELD_VALUE = 1_024
const MAX_FIELDS = 25

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function toEmbed(message: AlertMessage): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(truncate(message.title, MAX_TITLE))
    .setDescription(truncate(message.description, MAX_DESCRIPTION))
    .setColor(message.color)
    .setTimestamp(new Date(message.timestampIso))

  const fields = message.fields.slice(0, MAX_FIELDS).map((field) => ({
    name: truncate(field.name, MAX_TITLE),
    value: truncate(field.value, MAX_FIELD_VALUE),
    inline: field.inline ?? false,
  }))

  if (fields.length > 0) embed.addFields(fields)

  return embed
}
