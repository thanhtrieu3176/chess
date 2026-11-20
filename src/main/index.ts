import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { EVENTS } from '@shared/api'
import { openDatabase } from './db'
import { EnginePool } from './engine/EnginePool'
import { EvalCache } from './EvalCache'
import { fetchAndImport, registerIpc, send, startEngines, type Services } from './ipc'
import { initLogger, log, logError } from './logger'
import { SettingsStore } from './settings'
import { GamesRepo } from './services/games'
import { GameAnalyzer } from './services/analyzer'
import { PuzzleRepo } from './services/puzzles'
import { RepertoireRepo } from './services/repertoire'
import { computeStats } from './services/stats'
import { GeminiService } from './gemini/service'
import { Tablebase } from './net/tablebase'

let mainWindow: BrowserWindow | null = null
let services: Services | null = null

// Chỉ cho chạy 1 cửa sổ app (tránh 2 tiến trình cùng ghi một file SQLite).
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.focus()
})

function loadDevEnv(): void {
  if (app.isPackaged) return
  try {
    process.loadEnvFile(join(app.getAppPath(), '.env'))
  } catch {
    // không có file .env
  }
}

function createWindow(theme: 'dark' | 'light'): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: theme === 'dark' ? '#1c1b19' : '#f4f3ef',
    autoHideMenuBar: true,
    title: 'Chess Analyzer',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win.show())
  // Link ngoài mở bằng trình duyệt mặc định, không mở trong app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return win
}

/** Việc nền khi mở app: tải ván mới của tôi, rồi quét nhanh các ván chưa phân tích. */
async function startupJobs(s: Services): Promise<void> {
  const cfg = s.settings.get()
  if (cfg.autoFetchOnStart) {
    const jobs: Promise<unknown>[] = []
    const since = (site: 'chesscom' | 'lichess'): number => s.games.latestPlayedAt(site) ?? Date.now() - 30 * 86_400_000
    if (cfg.chesscomUsername)
      jobs.push(fetchAndImport(s, { site: 'chesscom', username: cfg.chesscomUsername, max: 100, since: since('chesscom') }))
    if (cfg.lichessUsername)
      jobs.push(fetchAndImport(s, { site: 'lichess', username: cfg.lichessUsername, max: 100, since: since('lichess') }))
    await Promise.allSettled(jobs) // lỗi mạng đã được báo qua sự kiện, không chặn app
  }
  if (cfg.backgroundAnalysis) s.analyzer.enqueueBackground(s.games.unanalyzedIds(30))
}

app.whenReady().then(() => {
  const t0 = Date.now()
  const userData = app.getPath('userData')
  const logDir = initLogger(join(userData, 'logs'))
  loadDevEnv()
  process.on('uncaughtException', (e) => logError('uncaughtException', e))
  process.on('unhandledRejection', (e) => logError('unhandledRejection', e))

  const db = openDatabase(join(userData, 'chess.db'))
  const settings = new SettingsStore(db)
  const warn = (m: string): void => log(m, 'WARN')
  const pool = new EnginePool(warn)
  const cache = new EvalCache(db)
  const tablebase = new Tablebase(db, warn)
  const games = new GamesRepo(db, cache, () => [settings.get().chesscomUsername, settings.get().lichessUsername])
  const puzzles = new PuzzleRepo(db)
  const repertoire = new RepertoireRepo(db)
  const gemini = new GeminiService(
    db,
    settings,
    {
      gameDetail: (id) => {
        const d = games.detail(id)
        return d ? { ...d, repertoire: null } : null
      },
      stats: () => computeStats(db),
      puzzle: (id) => puzzles.get(id)
    },
    warn
  )
  const s: Services = {
    db,
    settings,
    pool,
    cache,
    games,
    puzzles,
    repertoire,
    gemini,
    tablebase,
    userData,
    logDir,
    getWindow: () => mainWindow,
    analyzer: null as unknown as GameAnalyzer
  }
  s.analyzer = new GameAnalyzer({
    db,
    pool,
    cache,
    games,
    settings,
    tablebase,
    log: warn,
    onUpdate: (gameId, analysis) => send(s, EVENTS.analysisUpdate, { gameId, analysis }),
    onFinished: (gameId) => {
      send(s, EVENTS.gamesChanged)
      void gemini.prefetchGame(gameId)
    }
  })
  services = s
  registerIpc(s)
  mainWindow = createWindow(settings.get().theme)
  mainWindow.on('closed', () => (mainWindow = null))
  log(`Khởi động trong ${Date.now() - t0}ms`)

  // Engine và việc nền khởi động sau khi cửa sổ đã hiện, để không làm chậm lúc mở app.
  void startEngines(s).then(() => startupJobs(s))
})

app.on('window-all-closed', () => app.quit())

let quitting = false
app.on('before-quit', (e) => {
  if (quitting || !services) return
  quitting = true
  e.preventDefault()
  // Tắt Stockfish gọn gàng (tối đa ~1s), rồi mới thoát.
  void services.pool.shutdown().finally(() => {
    services?.db.close()
    app.quit()
  })
})

// Lưới an toàn cuối cùng: không để lại process Stockfish mồ côi.
process.on('exit', () => services?.pool.killAll())
