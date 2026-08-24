import { CHANNEL_TYPE_GUILD_TEXT, type ChannelOption } from './types.js'

export class ValidationError extends Error {}

const NAME_RE = /^[a-z0-9-]{1,32}$/

export function validateName(value: string): string {
  if (!NAME_RE.test(value)) {
    throw new ValidationError(
      'Tên chỉ được dùng chữ thường, số và dấu gạch ngang, dài 1-32 ký tự.',
    )
  }
  return value
}

export function validateUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new ValidationError('URL không đọc được. Ví dụ hợp lệ: https://example.com/health')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError('URL chỉ nhận scheme http hoặc https.')
  }
  if (parsed.username || parsed.password) {
    throw new ValidationError('URL không được chứa username hoặc password.')
  }
  return value
}

export function validateRange(label: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`${label} phải là số nguyên trong khoảng ${min}-${max}.`)
  }
  return value
}

export function validateChannel(channel: ChannelOption): string {
  if (channel.type !== CHANNEL_TYPE_GUILD_TEXT) {
    throw new ValidationError('Channel nhận alert phải là text channel của server.')
  }
  return channel.id
}
