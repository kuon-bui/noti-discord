import { describe, expect, it } from 'vitest'
import { isAdmin } from '../../src/bot/permissions.js'

const config = { adminUserIds: ['111', '222'] as readonly string[] }

describe('isAdmin', () => {
  it('user trong danh sách là admin', () => {
    expect(isAdmin('111', config)).toBe(true)
    expect(isAdmin('222', config)).toBe(true)
  })

  it('user ngoài danh sách không phải admin', () => {
    expect(isAdmin('333', config)).toBe(false)
  })

  it('so sánh chính xác, không so khớp một phần', () => {
    expect(isAdmin('11', config)).toBe(false)
    expect(isAdmin('1111', config)).toBe(false)
  })

  it('danh sách rỗng thì không ai là admin', () => {
    expect(isAdmin('111', { adminUserIds: [] })).toBe(false)
  })
})
