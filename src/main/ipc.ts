import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { API_METHODS, EVENTS, type Api } from '@shared/api'
import type { AnalysisResult, EngineInfo, EngineStatus, LiveUpdate } from '@shared/types'
import { EngineProcess } from './engine/EngineProcess'
import { EnginePool } from './engine/EnginePool'
import { downloadStockfish } from './engine/download'
import { EvalCache } from './EvalCache'
import { SettingsStore } from './settings'
import { log, logError } from './logger'

/** Khoảng cách tối thiểu giữa 2 lần đẩy kết quả phân tích trực tiếp lên UI (≤ 10 lần/giây). */
const LIVE_THROTTLE_MS = 100

export interface Services {
  db: DatabaseSync
  settings: SettingsStore
  pool: EnginePool
  cache: EvalCache
  userData: string
  logDir: string
  getWindow: () => BrowserWindow | null
}

let engineError: string | null = null

export async function startEngines(s: Services): Promise<void> {
  const cfg = s.settings.get()
  if (!cfg.enginePath) {
    engineError = 'Chưa chọn file Stockfish'
    return
  }
  const t0 = Date.now()
  try {
    await s.pool.start({
      path: cfg.enginePath,
      poolSize: cfg.poolSize,
      poolThreads: cfg.poolThreads,
      liveThreads: cfg.liveThreads,
      hashMb: cfg.hashMb,
      syzygyPath: cfg.syzygyPath || undefined
    })
    engineError = null
    log(`Engine sẵn sàng: ${s.pool.name} × ${cfg.poolSize + 1} trong ${Date.now() - t0}ms`)
  } catch (e) {
    engineError = e instanceof Error ? e.message : String(e)
    logError('Không khởi động được engine', e)
  }
}

function status(s: Services): EngineStatus {
  return {
    ready: engineError === null && s.pool.size > 0,
    name: s.pool.name,
    error: engineError,
    poolSize: s.pool.size,
    queued: s.pool.queued
  }
}

async function testEngine(path: string): Promise<EngineInfo> {
  const e = new EngineProcess(path, { threads: 1, hashMb: 16 })
  try {
    await e.start()
    return { ok: true, name: e.name ?? 'UCI engine' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await e.quit()
  }
}

export function registerIpc(s: Services): void {
  const send = (channel: string, payload: unknown): void => s.getWindow()?.webContents.send(channel, payload)

  const handlers: Api = {
    getSettings: async () => s.settings.get(),
    saveSettings: async (patch) => s.settings.save(patch),

    hasGeminiKey: async () => s.settings.getGeminiKey() !== null,
    setGeminiKey: async (key) => s.settings.setGeminiKey(key),
    testGemini: async () => {
      const key = s.settings.getGeminiKey()
      if (!key) return { ok: false, message: 'Chưa có API key' }
      const model = s.settings.get().geminiModel
      try {
        // Gọi endpoint lấy thông tin model: nhẹ, không tốn quota sinh nội dung.
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
          { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10_000) }
        )
        if (res.ok) return { ok: true, message: `Kết nối thành công, model "${model}" khả dụng` }
        if (res.status === 404) return { ok: false, message: `Key hợp lệ nhưng không tìm thấy model "${model}"` }
        if (res.status === 400 || res.status === 403) return { ok: false, message: 'API key không hợp lệ' }
        return { ok: false, message: `Lỗi HTTP ${res.status}` }
      } catch {
        return { ok: false, message: 'Không kết nối được tới Google (kiểm tra mạng)' }
      }
    },

    pickEngineFile: async () => {
      const win = s.getWindow()
      const opts = {
        title: 'Chọn file Stockfish',
        properties: ['openFile' as const],
        filters: process.platform === 'win32' ? [{ name: 'Chương trình', extensions: ['exe'] }] : []
      }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    testEngine,
    downloadStockfish: async () => {
      try {
        const path = await downloadStockfish(join(s.userData, 'engine'), (p) => send(EVENTS.downloadProgress, p))
        const info = await testEngine(path)
        return { ...info, path }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        logError('Tải Stockfish thất bại', e)
        send(EVENTS.downloadProgress, { stage: 'error', message })
        return { ok: false, error: message }
      }
    },
    engineStatus: async () => status(s),
    restartEngines: async () => {
      await startEngines(s)
      return status(s)
    },

    analyze: async (fen, limit, multipv, priority) => {
      const minDepth = limit.depth ?? 1
      const cached = s.cache.get(fen, minDepth, multipv)
      if (cached) return cached
      s.pool.promote(fen)
      const r = await s.pool.analyze(fen, limit, multipv, priority)
      s.cache.put(r, multipv)
      return r
    },
    startLive: async (fen, multipv) => {
      let last = 0
      let pending: ReturnType<typeof setTimeout> | null = null
      let latest: AnalysisResult | null = null
      const push = (r: AnalysisResult, done: boolean): void => {
        const u: LiveUpdate = { fen: r.fen, depth: r.depth, lines: r.lines, nps: r.nps, done }
        send(EVENTS.liveUpdate, u)
        last = Date.now()
      }
      // Hiện ngay kết quả cache (nếu có) để UI có đánh giá sơ bộ tức thì.
      const cached = s.cache.get(fen, 1, multipv)
      if (cached) push(cached, false)
      await s.pool.startLive(fen, multipv, (r, done) => {
        latest = r
        if (done) {
          if (pending) clearTimeout(pending)
          pending = null
          if (r.depth >= 10) s.cache.put(r, multipv)
          push(r, true)
          return
        }
        const wait = LIVE_THROTTLE_MS - (Date.now() - last)
        if (wait <= 0) push(r, false)
        else if (!pending) {
          pending = setTimeout(() => {
            pending = null
            if (latest) push(latest, false)
          }, wait)
        }
      })
    },
    stopLive: async () => s.pool.stopLive(),

    openLogFolder: async () => {
      await shell.openPath(s.logDir)
    }
  }

  for (const name of API_METHODS) {
    const fn = handlers[name] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(name, async (_e, ...args: unknown[]) => {
      try {
        return await fn(...args)
      } catch (e) {
        logError(`IPC ${name} lỗi`, e)
        throw e
      }
    })
  }
}
