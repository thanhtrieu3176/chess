/** Parse các dòng output UCI của Stockfish. Hàm thuần, có unit test. */

export interface UciInfo {
  depth: number
  seldepth?: number
  multipv: number
  /** Điểm theo góc nhìn BÊN ĐANG ĐI (đúng như UCI trả về). */
  score?: { cp?: number; mate?: number }
  /** lowerbound/upperbound: điểm chưa chính xác (đang aspiration search). */
  bound?: 'lower' | 'upper'
  nodes?: number
  nps?: number
  time?: number
  pv: string[]
}

const INT_FIELDS = new Set(['depth', 'seldepth', 'multipv', 'nodes', 'nps', 'time'])

/**
 * Parse một dòng `info ...`. Trả về null nếu không phải dòng info có depth
 * (ví dụ `info string ...` hay `info currmove ...`).
 */
export function parseInfo(line: string): UciInfo | null {
  const t = line.trim().split(/\s+/)
  if (t[0] !== 'info' || t[1] === 'string') return null

  const info: UciInfo = { depth: -1, multipv: 1, pv: [] }
  let i = 1
  while (i < t.length) {
    const key = t[i]!
    if (INT_FIELDS.has(key)) {
      const v = Number(t[i + 1])
      if (Number.isFinite(v)) (info as unknown as Record<string, number>)[key] = v
      i += 2
    } else if (key === 'score') {
      const kind = t[i + 1]
      const v = Number(t[i + 2])
      if (kind === 'cp') info.score = { cp: v }
      else if (kind === 'mate') info.score = { mate: v }
      i += 3
      if (t[i] === 'lowerbound') { info.bound = 'lower'; i++ }
      else if (t[i] === 'upperbound') { info.bound = 'upper'; i++ }
    } else if (key === 'pv') {
      // pv luôn là trường cuối cùng của dòng.
      info.pv = t.slice(i + 1)
      break
    } else {
      // Các trường bỏ qua: hashfull, tbhits, currmove, wdl (2 hoặc 3 giá trị)...
      i += key === 'wdl' ? 4 : 2
    }
  }
  return info.depth >= 0 ? info : null
}

/** Parse `bestmove e2e4 ponder e7e5`. Trả '(none)' → null khi không có nước hợp lệ. */
export function parseBestMove(line: string): { bestMove: string | null } | null {
  const t = line.trim().split(/\s+/)
  if (t[0] !== 'bestmove') return null
  const m = t[1]
  return { bestMove: !m || m === '(none)' ? null : m }
}

/**
 * Đổi điểm từ góc nhìn bên đi sang góc nhìn bên Trắng.
 */
export function toWhitePov(
  score: { cp?: number; mate?: number },
  side: 'w' | 'b'
): { cp?: number; mate?: number } {
  const sign = side === 'w' ? 1 : -1
  if (score.mate !== undefined) {
    // mate 0 = bên đi đã bị chiếu hết. Dấu của 0 không mang thông tin bên nào thắng,
    // nên quy đổi sang giá trị cp cực trị.
    if (score.mate === 0) return { cp: side === 'w' ? -100000 : 100000 }
    return { mate: score.mate * sign }
  }
  return { cp: (score.cp ?? 0) * sign }
}
