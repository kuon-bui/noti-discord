import { describe, expect, it } from 'bun:test'
import { toEmbed } from '../../src/notify/embeds.js'
import { digestMessage } from '../../src/notify/messages.js'
import type { AlertMessage, DigestReport } from '../../src/shared/types.js'

function message(overrides: Partial<AlertMessage> = {}): AlertMessage {
  return {
    kind: 'down',
    title: '🔴 web đang DOWN',
    description: 'Không đạt điều kiện kiểm tra sức khoẻ.',
    color: 0xed4245,
    fields: [
      { name: 'URL', value: 'https://a.test' },
      { name: 'Lý do', value: 'timeout sau 10000ms', inline: true },
    ],
    timestampIso: '2026-08-24T03:04:05.000Z',
    ...overrides,
  }
}

describe('toEmbed', () => {
  it('chuyển đủ title, description, color', () => {
    const json = toEmbed(message()).toJSON()
    expect(json.title).toBe('🔴 web đang DOWN')
    expect(json.description).toContain('kiểm tra sức khoẻ')
    expect(json.color).toBe(0xed4245)
  })

  it('chuyển fields kèm cờ inline', () => {
    const json = toEmbed(message()).toJSON()
    expect(json.fields).toHaveLength(2)
    expect(json.fields?.[0]).toMatchObject({ name: 'URL', value: 'https://a.test' })
    expect(json.fields?.[1]?.inline).toBe(true)
  })

  it('đặt timestamp từ timestampIso', () => {
    const json = toEmbed(message()).toJSON()
    expect(json.timestamp).toBe(new Date('2026-08-24T03:04:05.000Z').toISOString())
  })

  it('không có field thì vẫn dựng được embed', () => {
    const json = toEmbed(message({ fields: [] })).toJSON()
    expect(json.fields ?? []).toHaveLength(0)
  })

  it('cắt title vượt 256 ký tự', () => {
    const json = toEmbed(message({ title: 'x'.repeat(400) })).toJSON()
    expect((json.title as string).length).toBeLessThanOrEqual(256)
  })

  it('cắt description vượt 4096 ký tự', () => {
    const json = toEmbed(message({ description: 'y'.repeat(5_000) })).toJSON()
    expect((json.description as string).length).toBeLessThanOrEqual(4_096)
  })

  it('cắt field value vượt 1024 ký tự', () => {
    const json = toEmbed(message({ fields: [{ name: 'Dài', value: 'z'.repeat(2_000) }] })).toJSON()
    expect((json.fields?.[0]?.value as string).length).toBeLessThanOrEqual(1_024)
  })

  it('giới hạn số field ở 25 — mức tối đa Discord nhận', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ name: `f${index}`, value: 'v' }))
    const json = toEmbed(message({ fields: many })).toJSON()
    expect(json.fields?.length).toBeLessThanOrEqual(25)
  })

  it('giới hạn tổng ký tự của embed ở 6000', () => {
    const fields = Array.from({ length: 25 }, (_, index) => ({
      name: `field-${index}`.repeat(40),
      value: 'z'.repeat(2_000),
    }))
    const json = toEmbed(
      message({ title: 'x'.repeat(400), description: 'y'.repeat(5_000), fields }),
    ).toJSON()
    const total =
      (json.title?.length ?? 0) +
      (json.description?.length ?? 0) +
      (json.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0)
    expect(total).toBeLessThanOrEqual(6_000)
  })
})

describe('toEmbed với table', () => {
  const report: DigestReport = {
    rangeLabel: '24 giờ qua',
    lines: [
      {
        name: 'web-prod',
        currentStatus: 'UP',
        paused: false,
        uptimePct: 99.9,
        avgLatencyMs: 120,
        incidentCount: 1,
        downtimeMs: 65_000,
      },
    ],
  }

  it('render table thành code block với cột đã pad', () => {
    const json = toEmbed(digestMessage(report, '2026-08-26T00:00:00.000Z')).toJSON()
    // Chuỗi mong đợi lấy từ output thật của digestMessage trên code trước khi sửa
    // (chạy digestMessage với report này rồi copy description ra), không đếm khoảng trắng bằng mắt.
    expect(json.description).toBe(
      '```\n🟢 web-prod                 99.9%     120ms    1 sự cố  1m 5s\n```',
    )
  })

  it('table rỗng vẫn có câu thay thế', () => {
    const json = toEmbed(
      digestMessage({ rangeLabel: '24 giờ qua', lines: [] }, '2026-08-26T00:00:00.000Z'),
    ).toJSON()
    expect(json.description).toBe('```\nChưa có target nào được theo dõi.\n```')
  })
})
