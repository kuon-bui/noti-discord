/**
 * URL được lưu nguyên vẹn để probe, nhưng mọi bề mặt Discord phải che userinfo,
 * query và hash vì chúng thường chứa credential/token.
 */
export function redactUrlForDisplay(value: string): string {
  try {
    const parsed = new URL(value)
    const redactedSuffix = parsed.search || parsed.hash ? '?…' : ''
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${redactedSuffix}`
  } catch {
    return '<URL không hợp lệ>'
  }
}
