/** Kiểu dữ liệu dùng chung giữa main, preload và renderer. */

export interface Settings {
  displayName: string
  chesscomUsername: string
  lichessUsername: string
  autoFetchOnStart: boolean
  /** Đường dẫn tới stockfish.exe; null nếu chưa cấu hình. */
  enginePath: string | null
  /** Số instance Stockfish dùng để quét cả ván song song. */
  poolSize: number
  /** Số thread cho mỗi instance trong pool. */
  poolThreads: number
  /** Số thread cho engine phân tích trực tiếp (nước đang xem / sandbox). */
  liveThreads: number
  /** Hash (MB) cho MỖI instance. */
  hashMb: number
  /** Thời gian mỗi vị trí ở lượt quét nhanh. */
  quickMovetimeMs: number
  /** Độ sâu ở lượt phân tích kỹ. */
  deepDepth: number
  multiPv: number
  syzygyPath: string
  geminiModel: string
  theme: 'dark' | 'light'
}

/** Điểm số luôn theo góc nhìn của bên TRẮNG. Đúng một trong cp/mate có giá trị. */
export interface Score {
  cp?: number
  /** Số nước tới chiếu hết; dương = trắng chiếu hết, âm = đen chiếu hết. 0 = đã bị chiếu hết. */
  mate?: number
}

export interface EngineLine {
  multipv: number
  depth: number
  score: Score
  /** Chuỗi nước dạng UCI, ví dụ ["e2e4","e7e5"]. */
  pv: string[]
}

export interface AnalysisResult {
  fen: string
  depth: number
  lines: EngineLine[]
  bestMove: string | null
  nodes?: number
  nps?: number
}

export interface AnalysisLimit {
  movetime?: number
  depth?: number
  nodes?: number
  /** Phân tích vô hạn đến khi gọi stop. */
  infinite?: boolean
}

export type Priority = 'interactive' | 'game' | 'background'

export interface EngineInfo {
  ok: boolean
  name?: string
  error?: string
}

export interface EngineStatus {
  ready: boolean
  name: string | null
  error: string | null
  poolSize: number
  queued: number
}

export interface DownloadProgress {
  stage: 'download' | 'verify' | 'extract' | 'done' | 'error'
  received?: number
  total?: number
  message?: string
}

/** Dữ liệu stream lên UI khi phân tích trực tiếp. */
export interface LiveUpdate {
  fen: string
  depth: number
  lines: EngineLine[]
  nps?: number
  done: boolean
}
