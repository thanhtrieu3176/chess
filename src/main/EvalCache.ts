import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { AnalysisResult, EngineLine } from '@shared/types'
import { normalizeFen } from '@shared/fen'

const MEMORY_LIMIT = 5000

/** multipv = số biến đã YÊU CẦU (vị trí ít nước hợp lệ có thể trả ít dòng hơn). */
interface Entry {
  r: AnalysisResult
  multipv: number
}

/**
 * Cache đánh giá vị trí 2 tầng: Map trong RAM (LRU đơn giản) + bảng position_cache.
 * Mỗi vị trí giữ kết quả "tốt nhất": sâu hơn thắng; cùng độ sâu thì nhiều MultiPV hơn thắng.
 * Một kết quả sâu dùng lại được cho yêu cầu nông hơn.
 */
export class EvalCache {
  private mem = new Map<string, Entry>()
  private getStmt: StatementSync
  private putStmt: StatementSync

  constructor(db: DatabaseSync) {
    this.getStmt = db.prepare('SELECT multipv, depth, lines, best_move FROM position_cache WHERE fen = ?')
    this.putStmt = db.prepare(
      `INSERT INTO position_cache (fen, multipv, depth, lines, best_move, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(fen) DO UPDATE SET
         multipv = excluded.multipv, depth = excluded.depth, lines = excluded.lines,
         best_move = excluded.best_move, updated_at = excluded.updated_at
       WHERE excluded.depth > position_cache.depth
          OR (excluded.depth = position_cache.depth AND excluded.multipv > position_cache.multipv)`
    )
  }

  /** Lấy kết quả nếu đủ yêu cầu (đủ độ sâu và đủ số biến). */
  get(fen: string, minDepth: number, multipv: number): AnalysisResult | null {
    const key = normalizeFen(fen)
    let e = this.mem.get(key)
    if (!e) {
      const row = this.getStmt.get(key) as
        | { multipv: number; depth: number; lines: string; best_move: string | null }
        | undefined
      if (!row) return null
      e = {
        multipv: row.multipv,
        r: { fen, depth: row.depth, lines: JSON.parse(row.lines) as EngineLine[], bestMove: row.best_move }
      }
    }
    this.remember(key, e) // làm mới vị trí trong LRU
    if (e.r.depth < minDepth || e.multipv < multipv) return null
    return { ...e.r, fen, lines: e.r.lines.slice(0, multipv) }
  }

  /** Kết quả tốt nhất đã có cho vị trí (bất kể độ sâu), hoặc null. */
  peek(fen: string): AnalysisResult | null {
    return this.get(fen, 0, 1) && this.full(fen)
  }

  private full(fen: string): AnalysisResult | null {
    const e = this.mem.get(normalizeFen(fen))
    return e ? { ...e.r, fen } : null
  }

  put(r: AnalysisResult, multipv: number): void {
    if (r.lines.length === 0) return
    const key = normalizeFen(r.fen)
    const old = this.mem.get(key)
    if (!old || r.depth > old.r.depth || (r.depth === old.r.depth && multipv > old.multipv)) {
      this.remember(key, { r, multipv })
    }
    this.putStmt.run(key, multipv, r.depth, JSON.stringify(r.lines), r.bestMove, Date.now())
  }

  private remember(key: string, e: Entry): void {
    this.mem.delete(key)
    this.mem.set(key, e)
    if (this.mem.size > MEMORY_LIMIT) this.mem.delete(this.mem.keys().next().value!)
  }
}
