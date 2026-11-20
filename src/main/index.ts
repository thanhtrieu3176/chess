import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { openDatabase } from './db'
import { EnginePool } from './engine/EnginePool'
import { EvalCache } from './EvalCache'
import { registerIpc, startEngines, type Services } from './ipc'
import { initLogger, log, logError } from './logger'
import { SettingsStore } from './settings'

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
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
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

app.whenReady().then(() => {
  const t0 = Date.now()
  const userData = app.getPath('userData')
  const logDir = initLogger(join(userData, 'logs'))
  loadDevEnv()
  process.on('uncaughtException', (e) => logError('uncaughtException', e))
  process.on('unhandledRejection', (e) => logError('unhandledRejection', e))

  const db = openDatabase(join(userData, 'chess.db'))
  const settings = new SettingsStore(db)
  services = {
    db,
    settings,
    pool: new EnginePool((m) => log(m, 'WARN')),
    cache: new EvalCache(db),
    userData,
    logDir,
    getWindow: () => mainWindow
  }
  registerIpc(services)
  mainWindow = createWindow(settings.get().theme)
  mainWindow.on('closed', () => (mainWindow = null))
  log(`Khởi động trong ${Date.now() - t0}ms`)

  // Khởi động engine sau khi cửa sổ đã hiện, để không làm chậm lúc mở app.
  void startEngines(services)
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
