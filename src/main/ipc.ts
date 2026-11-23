import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { API_METHODS, EVENTS, type Api } from '@shared/api'
import type { AnalysisResult, EngineInfo, EngineStatus, FetchOptions, ImportResult, LiveUpdate } from '@shared/types'
import { openingAt as lookupOpening, nextBookMoves } from '@shared/openings'
import { moveMotifsFen, positionMotifsFen } from '@shared/tactics'
import { EngineProcess } from './engine/EngineProcess'
import { EnginePool } from './engine/EnginePool'
import { downloadStockfish } from './engine/download'
import { EvalCache } from './EvalCache'
import { SettingsStore } from './settings'
import { log, logError } from './logger'
import type { GamesRepo } from './services/games'
import type { GameAnalyzer } from './services/analyzer'
import type { PuzzleRepo } from './services/puzzles'
import type { RepertoireRepo } from './services/repertoire'
import { computeStats } from './services/stats'
import type { GeminiService } from './gemini/service'
import type { Tablebase } from './net/tablebase'
import { fetchChesscom, fetchChesscomRatings, fetchLichess } from './net/sites'

/** Khoảng cách tối thiểu giữa 2 lần đẩy kết quả phân tích trực tiếp lên UI (≤ 10 lần/giây). */
const LIVE_THROTTLE_MS = 100

export interface Services {
  db: DatabaseSync
  settings: SettingsStore
  pool: EnginePool
  cache: EvalCache
  games: GamesRepo
  analyzer: GameAnalyzer
  puzzles: PuzzleRepo
  repertoire: RepertoireRepo
  gemini: GeminiService
  tablebase: Tablebase
  userData: string
  logDir: string
  getWindow: () => BrowserWindow | null
}

let engineError: string | null = null

export function send(s: Services, channel: string, payload?: unknown): void {
  const w = s.getWindow()
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
}

export async function startEngines(s: Services): Promise<void> {
  const cfg = s.settings.get()
  s.pool.maxBackground = cfg.backgroundEngines
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

/** Áp dụng giới hạn "số ván giữ lại" sau mỗi lần thêm ván. */
export function enforceLimit(s: Services): void {
  const max = s.settings.get().maxGames
  if (max <= 0) return
  const total = s.games.storageInfo().games
  if (total <= max) return
  const r = s.games.prune(max)
  log(`Dọn dẹp: xóa ${r.deletedGames} ván cũ, dữ liệu ${(r.before / 1e6).toFixed(1)}MB → ${(r.after / 1e6).toFixed(1)}MB`)
  send(s, EVENTS.gamesChanged)
}

/** Tải ván từ Chess.com/Lichess, chỉ lấy ván chưa có; ván mới được xếp hàng phân tích nền. */
export async function fetchAndImport(s: Services, opts: FetchOptions): Promise<ImportResult> {
  const progress = (message: string, done = false, result?: ImportResult): void =>
    send(s, EVENTS.fetchProgress, { site: opts.site, message, done, result })
  try {
    const fetcher = opts.site === 'chesscom' ? fetchChesscom : fetchLichess
    const raw = await fetcher(opts, (id) => s.games.has(opts.site, id), progress)
    const result = s.games.importRaw(raw)
    enforceLimit(s)
    result.ids = result.ids.filter((id) => s.games.row(id) !== null)
    progress(`Đã tải ${result.added} ván mới${result.skipped ? `, bỏ qua ${result.skipped} ván đã có` : ''}`, true, result)
    if (result.added > 0) {
      send(s, EVENTS.gamesChanged)
      s.analyzer.enqueueBackground(result.ids)
    }
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    progress(`Lỗi: ${msg}`, true)
    throw e
  }
}

async function openFileDialog(s: Services, title: string): Promise<string | null> {
  const win = s.getWindow()
  const opts = { title, properties: ['openFile' as const], filters: [{ name: 'PGN', extensions: ['pgn'] }] }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return r.canceled || !r.filePaths[0] ? null : readFile(r.filePaths[0], 'utf8')
}

export function registerIpc(s: Services): void {
  const handlers: Api = {
    getSettings: async () => s.settings.get(),
    saveSettings: async (patch) => {
      const before = s.settings.get()
      const after = s.settings.save(patch)
      if (before.chesscomUsername !== after.chesscomUsername || before.lichessUsername !== after.lichessUsername) {
        s.games.refreshUserColors()
        send(s, EVENTS.gamesChanged)
      }
      s.pool.maxBackground = after.backgroundEngines
      if (after.maxGames !== before.maxGames) enforceLimit(s)
      return after
    },
    hasGeminiKey: async () => s.settings.getGeminiKey() !== null,
    setGeminiKey: async (key) => s.settings.setGeminiKey(key),
    testGemini: async () => {
      const key = s.settings.getGeminiKey()
      if (!key) return { ok: false, message: 'Chưa có API key' }
      const model = s.settings.get().geminiModel
      try {
        // Lấy thông tin model: nhẹ, không tốn quota sinh nội dung.
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, {
          headers: { 'x-goog-api-key': key },
          signal: AbortSignal.timeout(10_000)
        })
        if (res.ok) return { ok: true, message: `Kết nối thành công, model "${model}" khả dụng` }
        if (res.status === 404) return { ok: false, message: `Key hợp lệ nhưng không tìm thấy model "${model}"` }
        if (res.status === 400 || res.status === 403) return { ok: false, message: 'API key không hợp lệ' }
        return { ok: false, message: `Lỗi HTTP ${res.status}` }
      } catch {
        return { ok: false, message: 'Không kết nối được tới Google (kiểm tra mạng)' }
      }
    },
    openLogFolder: async () => {
      await shell.openPath(s.logDir)
    },
    storageInfo: async () => s.games.storageInfo(),
    cleanupStorage: async () => {
      const r = s.games.prune(s.settings.get().maxGames)
      send(s, EVENTS.gamesChanged)
      return r
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
        const path = await downloadStockfish(join(s.userData, 'engine'), (p) => send(s, EVENTS.downloadProgress, p))
        return { ...(await testEngine(path)), path }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        logError('Tải Stockfish thất bại', e)
        send(s, EVENTS.downloadProgress, { stage: 'error', message })
        return { ok: false, error: message }
      }
    },
    engineStatus: async () => status(s),
    restartEngines: async () => {
      await startEngines(s)
      return status(s)
    },
    analyze: async (fen, limit, multipv, priority) => {
      const cached = s.cache.get(fen, limit.depth ?? 1, multipv)
      if (cached) return cached
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
        send(s, EVENTS.liveUpdate, u)
        last = Date.now()
      }
      // Hiện ngay kết quả cache (nếu có) để có đánh giá sơ bộ tức thì, rồi tinh chỉnh dần.
      const cached = s.cache.peek(fen)
      if (cached) push({ ...cached, lines: cached.lines.slice(0, multipv) }, false)
      await s.pool.startLive(fen, multipv, (r, done) => {
        latest = r
        if (done) {
          if (pending) clearTimeout(pending)
          pending = null
          if (r.depth >= 12) s.cache.put(r, multipv)
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

    importPgn: async (text) => {
      const r = s.games.importPgn(text)
      if (r.added) {
        enforceLimit(s)
        r.ids = r.ids.filter((id) => s.games.row(id) !== null)
        send(s, EVENTS.gamesChanged)
        s.analyzer.enqueueBackground(r.ids)
      }
      return r
    },
    openPgnFile: async () => {
      const text = await openFileDialog(s, 'Mở file PGN')
      return text === null ? null : handlers.importPgn(text)
    },
    savePgnFile: async (pgn, name) => {
      const win = s.getWindow()
      const opts = { title: 'Lưu PGN', defaultPath: name, filters: [{ name: 'PGN', extensions: ['pgn'] }] }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (r.canceled || !r.filePath) return false
      await writeFile(r.filePath, pgn, 'utf8')
      return true
    },
    listGames: async (f) => s.games.list(f),
    getGame: async (id) => {
      const d = s.games.detail(id)
      if (!d) return null
      return { ...d, repertoire: s.repertoire.check(d.row.userColor, d.moves) }
    },
    deleteGame: async (id) => {
      s.games.delete(id)
      send(s, EVENTS.gamesChanged)
    },
    fetchGames: async (opts) => fetchAndImport(s, opts),

    analyzeGame: async (id) => {
      const r = await s.analyzer.analyze(id)
      send(s, EVENTS.gamesChanged)
      return r
    },
    cancelAnalysis: async () => s.analyzer.cancelCurrent(),
    promotePosition: async (fen) => s.pool.promote(fen),

    openingAt: async (fens) => fens.map((f) => lookupOpening(f)),
    nextBookMoves: async (fen) => nextBookMoves(fen),
    positionMotifs: async (fen, lastMoveUci, prevFen) => [
      ...(lastMoveUci && prevFen ? moveMotifsFen(prevFen, lastMoveUci) : []),
      ...positionMotifsFen(fen)
    ],
    tablebase: async (fen) => s.tablebase.lookup(fen),

    explain: async (req, requestId, cacheOnly) =>
      s.gemini.explain(req, (text) => send(s, EVENTS.explainChunk, { requestId, text }), { cacheOnly }),

    getStats: async () => computeStats(s.db),
    getRatings: async () => {
      try {
        return { ok: true, bySpeed: await fetchChesscomRatings(s.settings.get().chesscomUsername) }
      } catch (e) {
        return { ok: false, bySpeed: [], error: e instanceof Error ? e.message : String(e) }
      }
    },

    puzzleSummary: async () => s.puzzles.summary(),
    nextPuzzle: async (motif, excludeId) => s.puzzles.next(motif, excludeId),
    gradePuzzle: async (id, quality) => s.puzzles.grade(id, quality),

    repertoireList: async (color) => s.repertoire.list(color),
    repertoireAdd: async (color, parentId, uci) => s.repertoire.addMove(color, parentId, uci),
    repertoireComment: async (id, comment) => s.repertoire.setComment(id, comment),
    repertoireDelete: async (id) => s.repertoire.delete(id),
    repertoireImport: async (color, pgn) => s.repertoire.importPgn(color, pgn),
    repertoireImportFile: async (color) => {
      const text = await openFileDialog(s, 'Nhập repertoire từ PGN')
      return text === null ? null : s.repertoire.importPgn(color, text)
    },
    repertoireMovesAt: async (color, fen) => s.repertoire.movesAt(color, fen)
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
