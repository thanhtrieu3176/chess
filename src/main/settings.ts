import { cpus } from 'node:os'
import type { DatabaseSync } from 'node:sqlite'
import { safeStorage } from 'electron'
import type { Settings } from '@shared/types'
import { defaultEngineConfig } from './engine/EnginePool'

const SETTINGS_KEY = 'settings'
const GEMINI_KEY = 'geminiKey'

export function defaultSettings(): Settings {
  return {
    displayName: 'thanhtrieu',
    chesscomUsername: 'thanhtrieu31760',
    lichessUsername: '',
    autoFetchOnStart: true,
    enginePath: null,
    ...defaultEngineConfig(cpus().length),
    hashMb: 128,
    quickMovetimeMs: 250,
    deepDepth: 22,
    multiPv: 3,
    syzygyPath: '',
    geminiModel: 'gemini-2.5-flash',
    theme: 'dark'
  }
}

/** Đọc/ghi cài đặt trong bảng settings. API key Gemini lưu riêng, mã hóa bằng safeStorage. */
export class SettingsStore {
  private cache: Settings

  constructor(private readonly db: DatabaseSync) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY) as
      | { value: string }
      | undefined
    // Gộp với mặc định để các trường mới thêm ở phiên bản sau luôn có giá trị.
    this.cache = { ...defaultSettings(), ...(row ? (JSON.parse(row.value) as Partial<Settings>) : {}) }
  }

  get(): Settings {
    return { ...this.cache }
  }

  save(patch: Partial<Settings>): Settings {
    this.cache = { ...this.cache, ...patch }
    this.write(SETTINGS_KEY, JSON.stringify(this.cache))
    return this.get()
  }

  /**
   * Thứ tự lấy key: (1) key người dùng nhập (đã mã hóa), (2) biến môi trường GEMINI_API_KEY
   * (file .env khi chạy dev).
   */
  getGeminiKey(): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(GEMINI_KEY) as
      | { value: string }
      | undefined
    if (row?.value) {
      try {
        return safeStorage.decryptString(Buffer.from(row.value, 'base64'))
      } catch {
        // key hỏng (ví dụ copy DB sang máy khác) → bỏ qua
      }
    }
    return process.env.GEMINI_API_KEY?.trim() || null
  }

  setGeminiKey(key: string): void {
    const trimmed = key.trim()
    if (!trimmed) {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(GEMINI_KEY)
      return
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Hệ điều hành không hỗ trợ mã hóa safeStorage')
    this.write(GEMINI_KEY, safeStorage.encryptString(trimmed).toString('base64'))
  }

  private write(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }
}
