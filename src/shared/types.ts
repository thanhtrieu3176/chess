/** Kiểu dữ liệu dùng chung giữa main, preload và renderer. */
import type { Classification } from './analysis/classify'
import type { Motif } from './tactics'
import type { Phase } from './chess/phase'
import type { Opening } from './openings'
import type { GameMove, Speed } from './pgn'

export type { Classification, Motif, Phase, Opening, GameMove, Speed }


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
  /** Giới hạn request/phút cho Gemini (gói miễn phí). */
  geminiRpm: number
  /** Tự giải thích các khoảnh khắc quan trọng sau khi phân tích (tải trước nền). */
  geminiAutoExplain: boolean
  /** Gộp nhiều khoảnh khắc của một ván vào 1 request để tiết kiệm quota. */
  geminiBatch: boolean
  /** Tự quét nhanh các ván mới tải về ở chế độ nền. */
  backgroundAnalysis: boolean
  /** Số engine tối đa dành cho phân tích nền (giới hạn CPU). */
  backgroundEngines: number
  theme: 'dark' | 'light'
  boardTheme: BoardTheme
  pieceSet: PieceSet
  sound: boolean
}

export type BoardTheme = 'brown' | 'blue' | 'green' | 'gray'
export type PieceSet = 'cburnett' | 'merida' | 'alpha'

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

// ---------------------------------------------------------------------------
// Ván đấu, phân tích


export type GameSource = 'pgn' | 'chesscom' | 'lichess'
export type UserResult = 'win' | 'draw' | 'loss'

export interface GameRow {
  id: number
  source: GameSource
  sourceId: string | null
  white: string
  black: string
  whiteElo: number | null
  blackElo: number | null
  result: string
  termination: string | null
  playedAt: number | null
  timeControl: string | null
  speed: Speed | null
  eco: string | null
  openingName: string | null
  userColor: 'w' | 'b' | null
  userResult: UserResult | null
  analysisStatus: 'none' | 'quick' | 'deep'
  whiteAccuracy: number | null
  blackAccuracy: number | null
}

export interface GameFilter {
  text?: string
  result?: UserResult
  color?: 'w' | 'b'
  speed?: Speed
  opening?: string
  from?: number
  to?: number
  page?: number
  pageSize?: number
}

/** Kết quả tablebase (góc nhìn bên đang đi trong vị trí đó). */
export interface TablebaseResult {
  category: 'win' | 'draw' | 'loss' | 'unknown'
  dtz: number | null
  dtm: number | null
  bestUci: string | null
  bestSan: string | null
}

export interface PositionEval {
  depth: number
  lines: EngineLine[]
  /** Điểm tốt nhất (góc nhìn Trắng); với vị trí kết thúc ván thì là kết quả. */
  score: Score
  tablebase?: TablebaseResult | null
}

export interface MoveMotifs {
  /** Motif do nước đã đi tạo ra. */
  played: Motif[]
  /** Motif trong biến tốt nhất từ vị trí trước nước đi (những gì bị bỏ lỡ). */
  best: Motif[]
  /** Đe dọa của đối phương sau nước đã đi (những gì "dính"). */
  threats: Motif[]
}

export interface MoveAnalysis {
  ply: number
  color: 'w' | 'b'
  classification: Classification
  /** Win% góc nhìn người đi. */
  winBefore: number
  winAfter: number
  accuracy: number
  bestUci: string | null
  bestSan: string | null
  phase: Phase
  motifs: MoveMotifs
}

export interface GameAnalysis {
  status: 'running' | 'quick' | 'deep' | 'cancelled' | 'error'
  pass: 1 | 2
  done: number
  total: number
  /** Đánh giá các vị trí 0..n (null = chưa xong). */
  positions: (PositionEval | null)[]
  /** Kết quả các nước 1..n (index = ply − 1). */
  moves: (MoveAnalysis | null)[]
  accuracy: { w: number | null; b: number | null }
  error?: string
}

export interface RepertoireCheck {
  ply: number
  kind: 'user_deviated' | 'opponent_novelty'
  played: string
  expected: string[]
  message: string
}

export interface GameDetail {
  row: GameRow
  headers: Record<string, string>
  startFen: string
  moves: GameMove[]
  /** Khai cuộc hiện hành tại vị trí 0..n. */
  openings: (Opening | null)[]
  inBook: boolean[]
  outOfBookPly: number | null
  analysis: GameAnalysis | null
  repertoire: RepertoireCheck | null
}

export interface ImportResult {
  added: number
  skipped: number
  errors: string[]
  ids: number[]
}

export interface FetchOptions {
  site: 'chesscom' | 'lichess'
  username: string
  max: number
  since?: number
  until?: number
  speeds?: Speed[]
  color?: 'w' | 'b'
}

export interface FetchProgress {
  site: 'chesscom' | 'lichess'
  message: string
  done: boolean
  result?: ImportResult
}

// ---------------------------------------------------------------------------
// Gemini

export type ExplainRequest =
  | { kind: 'move'; gameId: number; ply: number }
  | { kind: 'position'; fen: string; uci: string }
  | { kind: 'game'; gameId: number }
  | { kind: 'opening'; fen: string }
  | { kind: 'overview' }
  | { kind: 'puzzle'; puzzleId: number }

export interface ExplainResult {
  ok: boolean
  data?: Record<string, unknown>
  warnings?: string[]
  error?: string
  cached?: boolean
}

export interface ExplainChunk {
  requestId: string
  /** Toàn bộ văn bản JSON nhận được tới thời điểm này. */
  text: string
}

// ---------------------------------------------------------------------------
// Thống kê

export interface Stats {
  games: number
  analyzed: number
  record: { win: number; draw: number; loss: number }
  openings: { color: 'w' | 'b'; family: string; games: number; win: number; draw: number; loss: number; avgAccuracy: number | null }[]
  phases: { phase: Phase; moves: number; accuracy: number | null; errorsPerGame: number; blundersPerGame: number }[]
  clock: { bucket: string; moves: number; blunders: number; mistakes: number }[]
  motifsMissed: { kind: string; count: number }[]
  motifsSuffered: { kind: string; count: number }[]
  accuracyTrend: { gameId: number; playedAt: number; accuracy: number; speed: Speed | null }[]
  ratingTrend: { playedAt: number; rating: number; speed: Speed | null }[]
  classCounts: Partial<Record<Classification, number>>
}

export interface Ratings {
  ok: boolean
  bySpeed: { speed: string; rating: number; best?: number }[]
  error?: string
}

// ---------------------------------------------------------------------------
// Puzzle, repertoire

export interface Puzzle {
  id: number
  gameId: number
  ply: number
  fen: string
  /** Nước UCI: [nước của tôi, đáp trả, nước của tôi, ...]. */
  solution: string[]
  motifs: string[]
  sourceClass: Classification
  dueAt: number
  repetitions: number
  lastResult: string | null
  /** Nước tôi đã đi trong ván (sai). */
  playedSan: string | null
}

export interface RepertoireNode {
  id: number
  color: 'w' | 'b'
  parentId: number | null
  parentFen: string
  fen: string
  uci: string
  san: string
  comment: string
}
