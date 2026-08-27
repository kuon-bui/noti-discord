import { describe, expect, it } from 'bun:test'
import { allCommands } from '../../src/bot/commands/index.js'
import { helpText, parseCommandText } from '../../src/messenger/parse-command.js'

const COMMANDS = allCommands()

function parse(text: string) {
  return parseCommandText(text, COMMANDS)
}

describe('parseCommandText', () => {
  it('lệnh không tham số', () => {
    const result = parse('status')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.commandName).toBe('status')
    expect(result.strings.size).toBe(0)
  })

  it('prefix / là tuỳ chọn', () => {
    expect(parse('/status').ok).toBe(true)
    expect(parse('status').ok).toBe(true)
  })

  it('không phân biệt hoa thường ở tên lệnh', () => {
    expect(parse('STATUS').ok).toBe(true)
  })

  it('positional theo đúng thứ tự khai báo trong builder', () => {
    const result = parse('add api https://x.dev')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.strings.get('name')).toBe('api')
    expect(result.strings.get('url')).toBe('https://x.dev')
  })

  it('dạng key=value cho option tuỳ chọn', () => {
    const result = parse('add api https://x.dev interval=30 timeout=5000')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.integers.get('interval')).toBe(30)
    expect(result.integers.get('timeout')).toBe(5_000)
  })

  it('URL có dấu = trong query không bị hiểu là key=value', () => {
    const result = parse('add api https://x.dev/h?token=abc')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.strings.get('url')).toBe('https://x.dev/h?token=abc')
  })

  it('integer sai thì báo lỗi rõ ràng, không im lặng thành null', () => {
    const result = parse('pause api abc')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('bad-argument')
    expect(result.message).toContain('minutes')
  })

  it('thiếu option bắt buộc thì báo tên nó', () => {
    const result = parse('add')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('name')
  })

  it('thừa tham số vị trí thì báo lỗi', () => {
    const result = parse('status a b c d e')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('bad-argument')
  })

  it('option kiểu channel không chiếm slot positional', () => {
    const result = parse('add api https://x.dev 30 5000 800')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.integers.get('latency')).toBe(800)
  })

  it('lệnh lạ thì trả kind unknown-command', () => {
    const result = parse('khongtontai')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('unknown-command')
  })

  it('text rỗng thì trả unknown-command', () => {
    const result = parse('   ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('unknown-command')
  })
})

describe('helpText', () => {
  it('không phải admin thì không thấy lệnh admin', () => {
    const text = helpText(COMMANDS, false)
    expect(text).toContain('status')
    expect(text).not.toContain('add ')
    expect(text).not.toContain('remove')
  })

  it('admin thì thấy đủ', () => {
    const text = helpText(COMMANDS, true)
    expect(text).toContain('status')
    expect(text).toContain('add')
    expect(text).toContain('pause')
  })
})
