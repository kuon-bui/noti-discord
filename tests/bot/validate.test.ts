import { describe, expect, it } from 'vitest'
import {
  ValidationError,
  validateChannel,
  validateName,
  validateRange,
  validateUrl,
} from '../../src/bot/validate.js'

describe('validateName', () => {
  it.each(['web', 'web-prod', 'api2', 'a', 'a'.repeat(32)])('nhận %o', (name) => {
    expect(validateName(name)).toBe(name)
  })

  it.each(['Web', 'web_prod', 'web prod', '', 'a'.repeat(33), 'wéb'])('từ chối %o', (name) => {
    expect(() => validateName(name)).toThrow(ValidationError)
  })

  it('message nêu rõ quy tắc', () => {
    expect(() => validateName('Web')).toThrow(/chữ thường/)
  })
})

describe('validateUrl', () => {
  it.each(['http://a.test', 'https://a.test/health?x=1'])('nhận %o', (url) => {
    expect(validateUrl(url)).toBe(url)
  })

  it.each(['ftp://a.test', 'a.test', '', 'javascript:alert(1)'])('từ chối %o', (url) => {
    expect(() => validateUrl(url)).toThrow(ValidationError)
  })

  it('message nêu rõ chỉ nhận http và https', () => {
    expect(() => validateUrl('ftp://a.test')).toThrow(/https?/)
  })

  it('từ chối URL chứa credentials', () => {
    expect(() => validateUrl('https://user:secret@example.test/health')).toThrow(/username|password/)
  })
})

describe('validateRange', () => {
  it('trả giá trị khi nằm trong biên', () => {
    expect(validateRange('interval', 60, 10, 86_400)).toBe(60)
  })

  it('nhận đúng giá trị biên', () => {
    expect(validateRange('interval', 10, 10, 86_400)).toBe(10)
    expect(validateRange('interval', 86_400, 10, 86_400)).toBe(86_400)
  })

  it('từ chối dưới biên dưới và trên biên trên, message có tên tham số', () => {
    expect(() => validateRange('interval', 9, 10, 86_400)).toThrow(/interval/)
    expect(() => validateRange('interval', 86_401, 10, 86_400)).toThrow(/interval/)
  })
})

describe('validateChannel', () => {
  it('nhận text channel của guild', () => {
    expect(validateChannel({ id: 'c1', type: 0 })).toBe('c1')
  })

  it('từ chối loại channel khác', () => {
    expect(() => validateChannel({ id: 'c1', type: 2 })).toThrow(ValidationError)
  })
})
