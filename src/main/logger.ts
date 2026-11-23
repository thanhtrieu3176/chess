import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

let logFile: string | null = null
const MAX_SIZE = 1024 * 1024

/** Ghi log ra <userData>/logs/app.log (giữ 1 bản cũ app.old.log khi vượt 1MB). */
export function initLogger(dir: string): string {
  mkdirSync(dir, { recursive: true })
  logFile = join(dir, 'app.log')
  try {
    if (statSync(logFile).size > MAX_SIZE) renameSync(logFile, join(dir, 'app.old.log'))
  } catch {
    // chưa có file log
  }
  return dir
}

export function log(msg: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): void {
  const line = `${new Date().toISOString()} [${level}] ${msg}`
  if (level === 'ERROR') console.error(line)
  else console.log(line)
  if (!logFile) return
  try {
    appendFileSync(logFile, line + '\n')
  } catch {
    // không để lỗi ghi log làm hỏng app
  }
}

export const logError = (msg: string, e?: unknown): void =>
  log(`${msg}${e ? `: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}` : ''}`, 'ERROR')
