import type {
  AnalysisLimit,
  AnalysisResult,
  DownloadProgress,
  EngineInfo,
  EngineStatus,
  LiveUpdate,
  Priority,
  Settings
} from './types'

/**
 * Hợp đồng IPC giữa renderer và main.
 * Mỗi method là một kênh `ipcRenderer.invoke(<tên method>, ...args)`.
 * App cá nhân, renderer là code của chính mình nên chỉ dùng type TS, không validate runtime.
 */
export interface Api {
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>

  /** Có Gemini key hay chưa (key không bao giờ được gửi xuống renderer). */
  hasGeminiKey(): Promise<boolean>
  setGeminiKey(key: string): Promise<void>
  testGemini(): Promise<{ ok: boolean; message: string }>

  pickEngineFile(): Promise<string | null>
  /** Handshake uci/uciok với một file engine, trả tên engine. */
  testEngine(path: string): Promise<EngineInfo>
  /** Tải Stockfish 19 chính thức từ GitHub về thư mục dữ liệu app. */
  downloadStockfish(): Promise<EngineInfo & { path?: string }>
  engineStatus(): Promise<EngineStatus>
  /** Khởi động lại engine pool với cấu hình hiện tại. */
  restartEngines(): Promise<EngineStatus>

  /** Phân tích có giới hạn qua hàng đợi ưu tiên. */
  analyze(fen: string, limit: AnalysisLimit, multipv: number, priority: Priority): Promise<AnalysisResult>
  /** Phân tích vô hạn trên engine riêng; kết quả đến qua onLiveUpdate. */
  startLive(fen: string, multipv: number): Promise<void>
  stopLive(): Promise<void>

  openLogFolder(): Promise<void>
}

/** Sự kiện main → renderer. */
export interface ApiEvents {
  onLiveUpdate(cb: (u: LiveUpdate) => void): () => void
  onDownloadProgress(cb: (p: DownloadProgress) => void): () => void
}

export type WindowApi = Api & ApiEvents

export const API_METHODS = [
  'getSettings',
  'saveSettings',
  'hasGeminiKey',
  'setGeminiKey',
  'testGemini',
  'pickEngineFile',
  'testEngine',
  'downloadStockfish',
  'engineStatus',
  'restartEngines',
  'analyze',
  'startLive',
  'stopLive',
  'openLogFolder'
] as const satisfies readonly (keyof Api)[]

export const EVENTS = {
  liveUpdate: 'event:liveUpdate',
  downloadProgress: 'event:downloadProgress'
} as const
