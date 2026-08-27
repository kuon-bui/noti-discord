import { describe, expect, it } from 'bun:test'
import {
  alertMessageToText,
  embedToText,
  MESSENGER_MAX_TEXT,
  splitForMessenger,
  stripMarkdown,
} from '../../src/notify/messenger-text.js'
import type { AlertMessage } from '../../src/shared/types.js'

describe('stripMarkdown', () => {
  it('bỏ bold, inline code và code fence', () => {
    expect(stripMarkdown('**web** dùng `api` trong ```khối```')).toBe('web dùng api trong khối')
  })

  it('không đụng text thường', () => {
    expect(stripMarkdown('web-prod — UP — 120 ms')).toBe('web-prod — UP — 120 ms')
  })
})

describe('splitForMessenger', () => {
  it('text ngắn thì trả một phần tử', () => {
    expect(splitForMessenger('ngắn')).toEqual(['ngắn'])
  })

  it('cắt theo ranh giới dòng, mỗi phần không vượt hạn', () => {
    const line = 'x'.repeat(90)
    const parts = splitForMessenger(Array.from({ length: 40 }, () => line).join('\n'), 200)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(200)
  })

  it('một dòng dài hơn hạn thì cắt cứng, không mất ký tự', () => {
    const parts = splitForMessenger('y'.repeat(500), 200)
    expect(parts.join('')).toBe('y'.repeat(500))
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(200)
  })

  it('hạn mặc định là 2000', () => {
    expect(MESSENGER_MAX_TEXT).toBe(2_000)
    const parts = splitForMessenger('z'.repeat(4_500))
    expect(parts).toHaveLength(3)
  })
})

describe('alertMessageToText', () => {
  const down: AlertMessage = {
    kind: 'down',
    targetName: 'api',
    title: '🔴 api đang DOWN',
    description: 'Không đạt điều kiện kiểm tra sức khoẻ.',
    color: 1,
    fields: [
      { name: 'URL', value: 'https://a.test/…' },
      { name: 'Lý do', value: 'HTTP 500' },
    ],
    timestampIso: '2026-08-26T00:00:00.000Z',
  }

  it('gộp title, description và field thành text phẳng', () => {
    const [text] = alertMessageToText(down)
    expect(text).toContain('🔴 api đang DOWN')
    expect(text).toContain('Không đạt điều kiện')
    expect(text).toContain('URL: https://a.test/…')
    expect(text).toContain('Lý do: HTTP 500')
  })

  it('render table thành từng dòng, không pad và không code fence', () => {
    const digest: AlertMessage = {
      kind: 'digest',
      title: '📊 Báo cáo',
      description: '',
      color: 1,
      fields: [],
      timestampIso: '2026-08-26T00:00:00.000Z',
      table: { rows: [['🟢', 'web', '99.9%', '120ms', '1', '1m 5s']] },
    }
    const [text] = alertMessageToText(digest)
    expect(text).toContain('🟢 web — 99.9% — 120ms — 1 sự cố — 1m 5s')
    expect(text).not.toContain('```')
    expect(text).not.toContain('  ')
  })

  it('table rỗng vẫn có câu thay thế', () => {
    const digest: AlertMessage = {
      kind: 'digest',
      title: '📊 Báo cáo',
      description: '',
      color: 1,
      fields: [],
      timestampIso: '2026-08-26T00:00:00.000Z',
      table: { rows: [] },
    }
    expect(alertMessageToText(digest)[0]).toContain('Chưa có target nào được theo dõi.')
  })
})

describe('embedToText', () => {
  it('đọc được hình dạng APIEmbed của discord.js', () => {
    const [text] = embedToText({
      title: '🟢 Kết quả kiểm tra web',
      description: 'Trạng thái: **UP**',
      fields: [{ name: 'Latency', value: '120 ms' }],
    })
    expect(text).toContain('🟢 Kết quả kiểm tra web')
    expect(text).toContain('Trạng thái: UP')
    expect(text).toContain('Latency: 120 ms')
  })

  it('embed thiếu field vẫn render được', () => {
    expect(embedToText({ title: 'chỉ có title' })).toEqual(['chỉ có title'])
  })
})
