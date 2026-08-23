export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  timestamp: number
  level: LogLevel
  message: string
  details?: string
}

let logs: LogEntry[] = []
const MAX_LOGS = 1000

type LogListener = (entry: LogEntry) => void
const listeners: Set<LogListener> = new Set()

export const logger = {
  log(level: LogLevel, message: string, details?: any) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      details: details ? (typeof details === 'string' ? details : JSON.stringify(details, null, 2)) : undefined,
    }

    logs.push(entry)
    if (logs.length > MAX_LOGS) {
      logs.shift()
    }

    console[level](message, details || '')
    listeners.forEach(l => l(entry))
  },

  info(message: string, details?: any) {
    this.log('info', message, details)
  },

  warn(message: string, details?: any) {
    this.log('warn', message, details)
  },

  error(message: string, details?: any) {
    this.log('error', message, details)
  },

  getLogs() {
    return [...logs]
  },

  clear() {
    logs = []
  },

  subscribe(listener: LogListener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}
