import type { LogLevel } from './types'

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export class Logger {
  private module: string
  private level: number

  constructor(module: string, level: LogLevel = 'info') {
    this.module = module
    this.level = LEVELS[level]
  }

  child = (module: string): Logger => {
    const child = new Logger(`${this.module}:${module}`)
    child.level = this.level
    return child
  }

  debug = (msg: string, data?: unknown) => this.log('debug', msg, data)
  info = (msg: string, data?: unknown) => this.log('info', msg, data)
  warn = (msg: string, data?: unknown) => this.log('warn', msg, data)
  error = (msg: string, data?: unknown) => this.log('error', msg, data)

  private log = (level: LogLevel, msg: string, data?: unknown) => {
    if (LEVELS[level] < this.level) return
    const ts = new Date().toISOString().substr(11, 12)
    const prefix = `[${ts}] [${level.toUpperCase()}] [${this.module}]`
    if (data !== undefined) {
      console.log(`${prefix} ${msg}`, data)
    } else {
      console.log(`${prefix} ${msg}`)
    }
  }
}
