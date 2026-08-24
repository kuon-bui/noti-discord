export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type Logger = {
  debug(msg: string, extra?: unknown): void
  info(msg: string, extra?: unknown): void
  warn(msg: string, extra?: unknown): void
  error(msg: string, extra?: unknown): void
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export function makeLogger(level: LogLevel = 'info'): Logger {
  const min = ORDER[level]
  const emit = (lvl: LogLevel, msg: string, extra?: unknown) => {
    if (ORDER[lvl] < min) return
    const line = `[${new Date().toISOString()}] ${lvl.toUpperCase()} ${msg}`
    if (extra === undefined) console.log(line)
    else console.log(line, extra)
  }
  return {
    debug: (m, e) => emit('debug', m, e),
    info: (m, e) => emit('info', m, e),
    warn: (m, e) => emit('warn', m, e),
    error: (m, e) => emit('error', m, e),
  }
}

export const silentLogger: Logger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
}