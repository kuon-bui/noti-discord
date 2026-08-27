import crypto from 'node:crypto'

const PREFIX = 'sha256='

export function verifySignature(
  raw: Uint8Array,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header || !header.startsWith(PREFIX)) return false

  const hex = header.slice(PREFIX.length)
  if (hex.length !== 64) return false

  let valid = true
  for (const char of hex) {
    if (!((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f'))) {
      valid = false
    }
  }
  if (!valid) return false

  const expected = crypto.createHmac('sha256', appSecret).update(raw).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(hex), Buffer.from(expected))
}
