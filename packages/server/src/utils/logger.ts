import type { Config } from '../types/config.js'

type LogLevel = Config['LOG_LEVEL']

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export interface Logger {
  debug: (msg: string, data?: unknown) => void
  info: (msg: string, data?: unknown) => void
  warn: (msg: string, data?: unknown) => void
  error: (msg: string, data?: unknown) => void
}

const shouldLog = (current: LogLevel, target: LogLevel): boolean =>
  LOG_LEVEL_ORDER[target] >= LOG_LEVEL_ORDER[current]

const createLine = (level: LogLevel, msg: string, data?: unknown): string => {
  if (data === undefined) {
    return JSON.stringify({
      level,
      ts: new Date().toISOString(),
      msg,
    })
  }

  return JSON.stringify({
    level,
    ts: new Date().toISOString(),
    msg,
    data,
  })
}

export const createLogger = (config: Config): Logger => {
  const write = (level: LogLevel, msg: string, data?: unknown): void => {
    if (!shouldLog(config.LOG_LEVEL, level)) return
    console.error(createLine(level, msg, data))
  }

  return {
    debug: (msg, data) => write('debug', msg, data),
    info: (msg, data) => write('info', msg, data),
    warn: (msg, data) => write('warn', msg, data),
    error: (msg, data) => write('error', msg, data),
  }
}
