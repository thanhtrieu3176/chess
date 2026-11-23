import type {
  AnalysisLimit,
  AnalysisResult,
  DownloadProgress,
  EngineInfo,
  EngineStatus,
  ExplainChunk,
  ExplainRequest,
  ExplainResult,
  FetchOptions,
  FetchProgress,
  GameAnalysis,
  GameDetail,
  GameFilter,
  GameRow,
  ImportResult,
  LiveUpdate,
  Motif,
  Opening,
  Priority,
  Puzzle,
  Ratings,
  RepertoireNode,
  Settings,
  Stats,
  StorageInfo,
  CleanupResult,
  TablebaseResult
} from './types'

/**
 * Hợp đồng IPC giữa renderer và main.
 * Mỗi method là một kênh `ipcRenderer.invoke(<tên method>, ...args)`.
 * App cá nhân, renderer là code của chính mình nên chỉ dùng type TS, không validate runtime.
 */
export interface Api {
  // Cài đặt
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  hasGeminiKey(): Promise<boolean>
  setGeminiKey(key: string): Promise<void>
  testGemini(): Promise<{ ok: boolean; message: string }>
  openLogFolder(): Promise<void>
  /** Dung lượng dữ liệu hiện tại. */
  storageInfo(): Promise<StorageInfo>
  /** Xóa ván vượt quá giới hạn "số ván giữ lại", dọn cache, thu gọn file dữ liệu. */
  cleanupStorage(): Promise<CleanupResult>

  // Engine
  pickEngineFile(): Promise<string | null>
  testEngine(path: string): Promise<EngineInfo>
  downloadStockfish(): Promise<EngineInfo & { path?: string }>
  engineStatus(): Promise<EngineStatus>
  restartEngines(): Promise<EngineStatus>
  analyze(fen: string, limit: AnalysisLimit, multipv: number, priority: Priority): Promise<AnalysisResult>
  /** Phân tích vô hạn trên engine riêng; kết quả đến qua onLiveUpdate. */
  startLive(fen: string, multipv: number): Promise<void>
  stopLive(): Promise<void>

  // Ván đấu
  importPgn(text: string): Promise<ImportResult>
  openPgnFile(): Promise<ImportResult | null>
  savePgnFile(pgn: string, name: string): Promise<boolean>
  listGames(filter: GameFilter): Promise<{ rows: GameRow[]; total: number }>
  getGame(id: number): Promise<GameDetail | null>
  deleteGame(id: number): Promise<void>
  fetchGames(opts: FetchOptions): Promise<ImportResult>

  // Phân tích ván
  analyzeGame(id: number): Promise<GameAnalysis | null>
  cancelAnalysis(): Promise<void>
  /** Đẩy vị trí lên đầu hàng đợi (khi người dùng bấm vào nước chưa phân tích). */
  promotePosition(fen: string): Promise<void>

  // Khai cuộc, chiến thuật, tablebase
  openingAt(fens: string[]): Promise<(Opening | null)[]>
  nextBookMoves(fen: string): Promise<{ uci: string; san: string; opening: Opening }[]>
  positionMotifs(fen: string, lastMoveUci?: string, prevFen?: string): Promise<Motif[]>
  tablebase(fen: string): Promise<TablebaseResult | null>

  // Gemini
  explain(req: ExplainRequest, requestId: string, cacheOnly?: boolean): Promise<ExplainResult>

  // Thống kê
  getStats(): Promise<Stats>
  getRatings(): Promise<Ratings>

  // Puzzle
  puzzleSummary(): Promise<{ total: number; due: number; motifs: { kind: string; count: number }[] }>
  nextPuzzle(motif?: string, excludeId?: number): Promise<Puzzle | null>
  gradePuzzle(id: number, quality: number): Promise<Puzzle | null>

  // Repertoire
  repertoireList(color: 'w' | 'b'): Promise<RepertoireNode[]>
  repertoireAdd(color: 'w' | 'b', parentId: number | null, uci: string): Promise<RepertoireNode>
  repertoireComment(id: number, comment: string): Promise<void>
  repertoireDelete(id: number): Promise<void>
  repertoireImport(color: 'w' | 'b', pgn: string): Promise<number>
  repertoireImportFile(color: 'w' | 'b'): Promise<number | null>
  repertoireMovesAt(color: 'w' | 'b', fen: string): Promise<{ uci: string; san: string; comment: string }[]>
}

/** Sự kiện main → renderer. */
export interface ApiEvents {
  onLiveUpdate(cb: (u: LiveUpdate) => void): () => void
  onDownloadProgress(cb: (p: DownloadProgress) => void): () => void
  onAnalysisUpdate(cb: (u: { gameId: number; analysis: GameAnalysis }) => void): () => void
  onFetchProgress(cb: (p: FetchProgress) => void): () => void
  onExplainChunk(cb: (c: ExplainChunk) => void): () => void
  onGamesChanged(cb: () => void): () => void
}

export type WindowApi = Api & ApiEvents

export const API_METHODS = [
  'getSettings',
  'saveSettings',
  'hasGeminiKey',
  'setGeminiKey',
  'testGemini',
  'openLogFolder',
  'storageInfo',
  'cleanupStorage',
  'pickEngineFile',
  'testEngine',
  'downloadStockfish',
  'engineStatus',
  'restartEngines',
  'analyze',
  'startLive',
  'stopLive',
  'importPgn',
  'openPgnFile',
  'savePgnFile',
  'listGames',
  'getGame',
  'deleteGame',
  'fetchGames',
  'analyzeGame',
  'cancelAnalysis',
  'promotePosition',
  'openingAt',
  'nextBookMoves',
  'positionMotifs',
  'tablebase',
  'explain',
  'getStats',
  'getRatings',
  'puzzleSummary',
  'nextPuzzle',
  'gradePuzzle',
  'repertoireList',
  'repertoireAdd',
  'repertoireComment',
  'repertoireDelete',
  'repertoireImport',
  'repertoireImportFile',
  'repertoireMovesAt'
] as const satisfies readonly (keyof Api)[]

export const EVENTS = {
  liveUpdate: 'event:liveUpdate',
  downloadProgress: 'event:downloadProgress',
  analysisUpdate: 'event:analysisUpdate',
  fetchProgress: 'event:fetchProgress',
  explainChunk: 'event:explainChunk',
  gamesChanged: 'event:gamesChanged'
} as const

// Kiểm tra lúc compile: mọi method của Api đều có trong API_METHODS.
type MissingMethods = Exclude<keyof Api, (typeof API_METHODS)[number]>
export const _allMethodsListed: MissingMethods extends never ? true : never = true
