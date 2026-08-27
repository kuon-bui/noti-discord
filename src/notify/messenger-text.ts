import type { AlertMessage } from '../shared/types.js'

/** Hạn ký tự một tin nhắn Messenger. */
export const MESSENGER_MAX_TEXT = 2_000

const EMPTY_TABLE = 'Chưa có target nào được theo dõi.'

/**
 * Messenger không render markdown, nó hiện nguyên ký tự. Các lệnh list/status/
 * history/uptime đang phát **bold** và `code`, nên phải bóc trước khi gửi.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```/g, '')
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/`([^`]+)`/g, '$1')
}

export function splitForMessenger(text: string, max = MESSENGER_MAX_TEXT): string[] {
  const chunks: string[] = []
  let current = ''

  for (const line of text.split('\n')) {
    const candidate = current.length > 0 ? `${current}\n${line}` : line
    if (candidate.length <= max) {
      current = candidate
      continue
    }

    if (current.length > 0) chunks.push(current)

    // Một dòng đơn dài hơn hạn thì cắt cứng — thà xấu còn hơn mất chữ.
    let rest = line
    while (rest.length > max) {
      chunks.push(rest.slice(0, max))
      rest = rest.slice(max)
    }
    current = rest
  }

  if (current.length > 0) chunks.push(current)
  return chunks.length > 0 ? chunks : ['']
}

function tableToLines(rows: readonly string[][]): string {
  if (rows.length === 0) return EMPTY_TABLE
  return rows
    .map((cells) => {
      const [icon = '', name = '', uptime = '', latency = '', incidents = '', downtime = ''] =
        cells
      return `${icon} ${name} — ${uptime} — ${latency} — ${incidents} sự cố — ${downtime}`
    })
    .join('\n')
}

type Parts = {
  title?: string
  body?: string
  fields?: ReadonlyArray<{ name: string; value: string }>
}

function compose(parts: Parts): string[] {
  const lines: string[] = []
  if (parts.title) lines.push(parts.title)
  if (parts.body) lines.push(parts.body)
  for (const field of parts.fields ?? []) lines.push(`${field.name}: ${field.value}`)
  return splitForMessenger(stripMarkdown(lines.join('\n')))
}

export function alertMessageToText(msg: AlertMessage): string[] {
  const body = msg.table ? tableToLines(msg.table.rows) : msg.description
  return compose({ title: msg.title, body, fields: msg.fields })
}

/** Hình dạng APIEmbed mà `EmbedBuilder.toJSON()` trả về, thu gọn còn phần ta dùng. */
export type EmbedLike = {
  title?: string
  description?: string
  fields?: ReadonlyArray<{ name: string; value: string }>
}

export function embedToText(embed: EmbedLike): string[] {
  return compose({ title: embed.title, body: embed.description, fields: embed.fields })
}
