import { describe, expect, it } from 'vitest'
import { redactUrlForDisplay } from '../../src/shared/url.js'

describe('redactUrlForDisplay', () => {
  it('bỏ userinfo và che query/hash', () => {
    expect(
      redactUrlForDisplay('https://user:password@example.test/health?token=top-secret#fragment'),
    ).toBe('https://example.test/health?…')
  })

  it('giữ URL không chứa dữ liệu nhạy cảm', () => {
    expect(redactUrlForDisplay('https://example.test/health')).toBe('https://example.test/health')
  })

  it('không trả dữ liệu raw nếu URL legacy không parse được', () => {
    expect(redactUrlForDisplay('not-a-url?token=top-secret')).toBe('<URL không hợp lệ>')
  })
})
