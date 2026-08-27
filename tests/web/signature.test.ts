import crypto from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import { verifySignature } from '../../src/web/signature.js'

const SECRET = 'app-secret'

function sign(raw: Uint8Array, secret = SECRET): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`
}

const body = new TextEncoder().encode('{"object":"page","entry":[]}')

describe('verifySignature', () => {
  it('signature đúng thì pass', () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true)
  })

  it('secret khác thì fail', () => {
    expect(verifySignature(body, sign(body, 'secret-khác'), SECRET)).toBe(false)
  })

  it('body đổi một byte thì fail', () => {
    const tampered = new TextEncoder().encode('{"object":"page","entry":[1]}')
    expect(verifySignature(tampered, sign(body), SECRET)).toBe(false)
  })

  it('thiếu header thì fail', () => {
    expect(verifySignature(body, undefined, SECRET)).toBe(false)
  })

  it('sai prefix thì fail', () => {
    const hex = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
    expect(verifySignature(body, `sha1=${hex}`, SECRET)).toBe(false)
    expect(verifySignature(body, hex, SECRET)).toBe(false)
  })

  it('hex không hợp lệ thì fail, không throw', () => {
    expect(verifySignature(body, 'sha256=không-phải-hex', SECRET)).toBe(false)
    expect(verifySignature(body, 'sha256=', SECRET)).toBe(false)
  })

  it('hex đúng định dạng nhưng sai độ dài thì fail', () => {
    expect(verifySignature(body, 'sha256=abcd', SECRET)).toBe(false)
  })

  it('tính trên raw bytes: JSON re-serialize khác thứ tự key thì fail', () => {
    const original = new TextEncoder().encode('{"a":1,"b":2}')
    const reserialized = new TextEncoder().encode('{"b":2,"a":1}')
    expect(verifySignature(reserialized, sign(original), SECRET)).toBe(false)
  })
})
