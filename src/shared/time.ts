export const VN_TZ = 'Asia/Ho_Chi_Minh'

export type Clock = () => Date

const dateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: VN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
})

const hourParts = new Intl.DateTimeFormat('en-US', {
  timeZone: VN_TZ, hour: '2-digit', hourCycle: 'h23',
})

export function vnDateString(d: Date): string {
  const p = new Map(dateParts.formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.get('year')}-${p.get('month')}-${p.get('day')}`
}

export function vnHour(d: Date): number {
  const hour = hourParts.formatToParts(d).find((x) => x.type === 'hour')
  return Number(hour?.value ?? '0')
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return '0s'
  const total = Math.floor(ms / 1000)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  if (seconds || parts.length === 0) parts.push(`${seconds}s`)
  return parts.join(' ')
}