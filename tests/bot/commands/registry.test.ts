import { describe, expect, it } from 'bun:test'
import { allCommands } from '../../../src/bot/commands/index.js'

describe('allCommands', () => {
  it('đăng ký đủ 9 lệnh', () => {
    expect(allCommands()).toHaveLength(9)
  })

  it('có đúng tập tên lệnh mong đợi', () => {
    expect(allCommands().map((command) => command.name).sort()).toEqual([
      'add',
      'check',
      'history',
      'list',
      'pause',
      'remove',
      'resume',
      'status',
      'uptime',
    ])
  })

  it('không có tên trùng', () => {
    const names = allCommands().map((command) => command.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('Command.name luôn khớp tên trong data', () => {
    for (const command of allCommands()) {
      expect(command.data.name).toBe(command.name)
      expect((command.data.toJSON() as { name: string }).name).toBe(command.name)
    }
  })

  it('chỉ add, remove, pause, resume là lệnh admin', () => {
    const admin = allCommands()
      .filter((command) => command.adminOnly)
      .map((command) => command.name)
      .sort()
    expect(admin).toEqual(['add', 'pause', 'remove', 'resume'])
  })

  it('mọi lệnh đều có execute là hàm', () => {
    for (const command of allCommands()) {
      expect(typeof command.execute).toBe('function')
    }
  })
})
