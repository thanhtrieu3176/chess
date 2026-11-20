/**
 * Phân tích cả ván theo 2 lượt (xem docs/ARCHITECTURE.md mục 4):
 *  - Lượt 1: quét nhanh n+1 vị trí (movetime ngắn, MultiPV 2) song song trên engine pool.
 *  - Lượt 2: phân tích sâu (depth cao, MultiPV 3) các nước quan trọng.
 * Mỗi vị trí chỉ phân tích 1 lần (điểm "sau nước N" = điểm "trước nước N+1") và lấy từ cache nếu có.
 * Kết quả đẩy dần lên UI sau mỗi vị trí xong.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { AnalysisResult, GameAnalysis, PositionEval, Priority } from '@shared/types'
import { analyzeMoves, importantPlies, puzzleFrom, terminalEval } from '@shared/analysis/game'
import { CancelledError, type EnginePool } from '../engine/EnginePool'
import type { EvalCache } from '../EvalCache'
import type { Tablebase } from '../net/tablebase'
import type { SettingsStore } from '../settings'
import { accuracyOf, type GamesRepo } from './games'
import { newSm2 } from '@shared/sm2'

const UPDATE_THROTTLE_MS = 150
/** Kết quả cache từ lượt quét nhanh trước đó được coi là đủ dùng nếu đạt độ sâu này. */
const QUICK_MIN_DEPTH = 10

export interface AnalyzerDeps {
  db: DatabaseSync
  pool: EnginePool
  cache: EvalCache
  games: GamesRepo
  settings: SettingsStore
  tablebase: Tablebase
  log: (m: string) => void
  onUpdate: (gameId: number, a: GameAnalysis) => void
  /** Gọi khi phân tích xong (để tải trước lời giải thích Gemini...). */
  onFinished: (gameId: number) => void
}

interface Run {
  gameId: number
  priority: Priority
  cancelled: boolean
}

export class GameAnalyzer {
  private current: Run | null = null
  private background: number[] = []
  private backgroundRunning = false

  constructor(private readonly d: AnalyzerDeps) {}

  get currentGameId(): number | null {
    return this.current?.priority === 'game' ? this.current.gameId : null
  }

  /** Phân tích ván đang mở (hủy ván đang phân tích trước đó, nếu có). */
  analyze(gameId: number, deep = true): Promise<GameAnalysis | null> {
    if (this.current && this.current.priority === 'game') this.cancelCurrent()
    return this.run({ gameId, priority: 'game', cancelled: false }, deep)
  }

  cancelCurrent(): void {
    if (!this.current) return
    this.current.cancelled = true
    this.d.pool.cancel(this.current.priority)
  }

  /** Thêm ván vào hàng đợi phân tích nền (chỉ quét nhanh). */
  enqueueBackground(ids: number[]): void {
    for (const id of ids) if (!this.background.includes(id)) this.background.push(id)
    void this.drainBackground()
  }

  private async drainBackground(): Promise<void> {
    if (this.backgroundRunning) return
    this.backgroundRunning = true
    try {
      while (this.background.length > 0 && this.d.settings.get().backgroundAnalysis) {
        const id = this.background.shift()!
        const row = this.d.games.row(id)
        if (!row || row.analysisStatus !== 'none') continue
        await this.run({ gameId: id, priority: 'background', cancelled: false }, false).catch((e: unknown) =>
          this.d.log(`Phân tích nền ván ${id} lỗi: ${String(e)}`)
        )
      }
    } finally {
      this.backgroundRunning = false
    }
  }

  private async run(run: Run, deep: boolean): Promise<GameAnalysis | null> {
    const detail = this.d.games.detail(run.gameId)
    if (!detail) return null
    if (run.priority === 'game') this.current = run
    else if (!this.current) this.current = run
    const s = this.d.settings.get()
    const fens = [detail.startFen, ...detail.moves.map((m) => m.fenAfter)]
    const ctx = { startFen: detail.startFen, moves: detail.moves, inBook: detail.inBook }
    const positions: (PositionEval | null)[] = fens.map(() => null)
    const state: GameAnalysis = {
      status: 'running',
      pass: 1,
      done: 0,
      total: fens.length,
      positions,
      moves: [],
      accuracy: { w: null, b: null }
    }
    const t0 = Date.now()

    let lastEmit = 0
    let pending: ReturnType<typeof setTimeout> | null = null
    const emit = (force = false): void => {
      if (run.priority !== 'game') return
      const send = (): void => {
        lastEmit = Date.now()
        state.moves = analyzeMoves(ctx, positions, false)
        this.d.onUpdate(run.gameId, { ...state, positions: [...positions] })
      }
      if (pending) clearTimeout(pending)
      pending = null
      if (force || Date.now() - lastEmit >= UPDATE_THROTTLE_MS) send()
      else pending = setTimeout(send, UPDATE_THROTTLE_MS)
    }

    const toEval = (r: AnalysisResult): PositionEval => ({
      depth: r.depth,
      lines: r.lines,
      score: r.lines[0]?.score ?? { cp: 0 }
    })

    try {
      if (run.priority === 'game') this.d.pool.newGame()

      // Tablebase cho tàn cuộc ≤ 7 quân (lỗi mạng → bỏ qua, không làm hỏng phân tích).
      const tbs = await Promise.all(fens.map((f) => this.d.tablebase.lookup(f)))

      // ---- Lượt 1: quét nhanh
      await Promise.all(
        fens.map(async (fen, i) => {
          const terminal = terminalEval(fen)
          let ev: PositionEval
          if (terminal) ev = terminal
          else {
            const cached = this.d.cache.get(fen, QUICK_MIN_DEPTH, 2)
            const r = cached ?? (await this.d.pool.analyze(fen, { movetime: s.quickMovetimeMs }, 2, run.priority))
            if (!cached) this.d.cache.put(r, 2)
            ev = toEval(r)
          }
          ev.tablebase = tbs[i]
          positions[i] = ev
          state.done++
          emit()
        })
      )
      if (run.cancelled) throw new CancelledError()

      // ---- Lượt 2: phân tích sâu các nước quan trọng
      let status: 'quick' | 'deep' = 'quick'
      if (deep) {
        const quickMoves = analyzeMoves(ctx, positions, false)
        const plies = importantPlies(quickMoves, positions)
        const idx = [...new Set(plies.flatMap((p) => [p - 1, p]))].filter((i) => !terminalEval(fens[i]!))
        state.pass = 2
        state.done = 0
        state.total = idx.length
        emit(true)
        await Promise.all(
          idx.map(async (i) => {
            const fen = fens[i]!
            const cached = this.d.cache.get(fen, s.deepDepth, s.multiPv)
            const r = cached ?? (await this.d.pool.analyze(fen, { depth: s.deepDepth }, s.multiPv, run.priority))
            if (!cached) this.d.cache.put(r, s.multiPv)
            positions[i] = { ...toEval(r), tablebase: tbs[i] }
            state.done++
            emit()
          })
        )
        if (run.cancelled) throw new CancelledError()
        status = 'deep'
      }

      // Phân tích nền không được ghi đè kết quả của lần phân tích (sâu hơn) do người dùng mở ván.
      if (run.priority === 'background') {
        const busy = this.current !== run && this.current?.gameId === run.gameId
        if (busy || this.d.games.row(run.gameId)?.analysisStatus === 'deep') return null
      }

      // ---- Kết quả cuối: có motif, accuracy, lưu DB, tạo puzzle
      const full = analyzeMoves(ctx, positions, true)
      const moves = full.filter((m): m is NonNullable<typeof m> => m !== null)
      state.moves = full
      state.status = status
      state.accuracy = accuracyOf(positions as PositionEval[], detail.moves[0]?.color ?? 'w')
      this.d.games.saveAnalysis(run.gameId, fens, moves, status, state.accuracy)
      this.createPuzzles(run.gameId, detail.row.userColor, fens, positions as PositionEval[], moves)
      if (pending) clearTimeout(pending)
      if (run.priority === 'game') this.d.onUpdate(run.gameId, { ...state, positions: [...positions] })
      this.d.log(`Phân tích ván ${run.gameId} (${status}) xong trong ${((Date.now() - t0) / 1000).toFixed(1)}s`)
      this.d.onFinished(run.gameId)
      return state
    } catch (e) {
      if (pending) clearTimeout(pending)
      state.status = e instanceof CancelledError ? 'cancelled' : 'error'
      state.error = e instanceof Error ? e.message : String(e)
      if (run.priority === 'game' && !(e instanceof CancelledError)) this.d.onUpdate(run.gameId, { ...state, positions: [...positions] })
      if (!(e instanceof CancelledError)) throw e
      return null
    } finally {
      if (this.current === run) this.current = null
      if (run.priority === 'game') void this.drainBackground()
    }
  }

  private createPuzzles(
    gameId: number,
    userColor: 'w' | 'b' | null,
    fens: string[],
    positions: PositionEval[],
    moves: ReturnType<typeof analyzeMoves> extends (infer T)[] ? NonNullable<T>[] : never
  ): void {
    if (!userColor) return
    const ins = this.d.db.prepare(`
      INSERT OR IGNORE INTO puzzles (game_id, ply, fen, solution, motifs, source_class, ease, interval_days, repetitions, due_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const m of moves) {
      if (m.color !== userColor || !['mistake', 'blunder', 'miss'].includes(m.classification)) continue
      const p = puzzleFrom(fens[m.ply - 1]!, positions[m.ply - 1]!, m.color)
      if (!p) continue
      const sm = newSm2()
      ins.run(gameId, m.ply, fens[m.ply - 1]!, JSON.stringify(p.solution), JSON.stringify(p.motifs), m.classification, sm.ease, 0, 0, sm.dueAt)
    }
  }
}
