/**
 * Từ đánh giá engine của các vị trí 0..n → kết quả từng nước (Win%, accuracy, phân loại, motif).
 * Hàm thuần: main gọi lại mỗi khi có thêm vị trí phân tích xong (hiển thị dần).
 */
import type { GameMove, MoveAnalysis, MoveMotifs, PositionEval, TablebaseResult } from '../types'
import { classify, KEY_MOMENTS, type TbOutcome } from './classify'
import { moveAccuracy } from './accuracy'
import { winFor, winPercent } from './winPercent'
import { fromFen, isCapture, legalMoveCount, parseUci, pvToSan, uciToSan } from '../chess/position'
import { phasesOf } from '../chess/phase'
import { isSacrifice, lineMotifs, moveMotifs, type Motif } from '../tactics'

export interface GameContext {
  startFen: string
  moves: GameMove[]
  inBook: boolean[]
}

/** Đánh giá của vị trí kết thúc ván (không cần engine), null nếu ván chưa kết thúc. */
export function terminalEval(fen: string): PositionEval | null {
  const pos = fromFen(fen)
  if (pos.isCheckmate()) return { depth: 0, lines: [], score: { cp: pos.turn === 'white' ? -100000 : 100000 } }
  if (pos.isStalemate() || pos.isInsufficientMaterial()) return { depth: 0, lines: [], score: { cp: 0 } }
  return null
}

function tbOutcome(tb: TablebaseResult | null | undefined, invert: boolean): TbOutcome | null {
  if (!tb || tb.category === 'unknown') return null
  if (!invert || tb.category === 'draw') return tb.category
  return tb.category === 'win' ? 'loss' : 'win'
}

const EMPTY_MOTIFS: MoveMotifs = { played: [], best: [], threats: [] }

/** Phát hiện motif là phần phụ: lỗi ở đây không được làm hỏng cả lần phân tích ván. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export function analyzeMoves(ctx: GameContext, positions: (PositionEval | null)[], withMotifs: boolean): (MoveAnalysis | null)[] {
  const boards = [fromFen(ctx.startFen).board, ...ctx.moves.map((m) => fromFen(m.fenAfter).board)]
  const phases = phasesOf(boards)
  const out: (MoveAnalysis | null)[] = []

  ctx.moves.forEach((m, i) => {
    const before = positions[i]
    const after = positions[i + 1]
    if (!before || !after) {
      out.push(null)
      return
    }
    const color = m.color
    const pos = fromFen(m.fenBefore)
    const move = parseUci(m.uci)!
    const tbBefore = tbOutcome(before.tablebase, false)
    const tbAfter = tbOutcome(after.tablebase, true)
    const bestUci = before.lines[0]?.pv[0] ?? before.tablebase?.bestUci ?? null
    const winBefore = winFor(before.score, color)
    // Nước đi đúng nước tốt nhất: Win% không thể kém hơn chính nó (tránh nhiễu do engine dao động).
    const winAfterRaw = winFor(after.score, color)
    const winAfter = m.uci === bestUci ? Math.max(winAfterRaw, winBefore) : winAfterRaw
    const prev = ctx.moves[i - 1]
    const isRecapture = !!prev && isCapture(pos, move) && 'to' in move && prev.uci.slice(2, 4) === m.uci.slice(2, 4)

    const classification = classify({
      winBefore,
      winAfter,
      playedUci: m.uci,
      bestUci,
      secondBestWin: before.lines[1] ? winFor(before.lines[1].score, color) : undefined,
      isBook: ctx.inBook[i + 1] ?? false,
      sacrifice: safe(() => isSacrifice(pos, move), false),
      isRecapture,
      forced: legalMoveCount(pos) === 1,
      prevOpponent: out[i - 1]?.classification ?? null,
      tablebase: tbBefore && tbAfter ? { before: tbBefore, after: tbAfter } : undefined
    })

    out.push({
      ply: m.ply,
      color,
      classification,
      winBefore,
      winAfter,
      accuracy: moveAccuracy(winBefore, winAfter),
      bestUci,
      bestSan: bestUci ? uciToSan(m.fenBefore, bestUci) : null,
      phase: phases[i]!,
      motifs: withMotifs ? safe(() => motifsFor(m, before, after, bestUci), EMPTY_MOTIFS) : EMPTY_MOTIFS
    })
  })
  return out
}

function motifsFor(m: GameMove, before: PositionEval, after: PositionEval, bestUci: string | null): MoveMotifs {
  const pos = fromFen(m.fenBefore)
  const played = moveMotifs(pos, parseUci(m.uci)!)
  const best = bestUci && bestUci !== m.uci && before.lines[0] ? lineMotifs(m.fenBefore, before.lines[0].pv, 4) : []
  const opponent = m.color === 'w' ? 'b' : 'w'
  // Đe dọa: những gì đối phương làm được trong biến tốt nhất sau nước của tôi.
  const threats: Motif[] = after.lines[0]
    ? lineMotifs(m.fenAfter, after.lines[0].pv, 3).filter((x) => x.side === opponent)
    : []
  return { played, best: best.filter((x) => x.side === m.color), threats }
}

/**
 * Các nước cần phân tích sâu ở lượt 2: khoảnh khắc quan trọng (Brilliant/Great/Mistake/Miss/Blunder)
 * và các vị trí mà Win% dao động mạnh (≥ 15 điểm).
 */
export function importantPlies(moves: (MoveAnalysis | null)[], positions: (PositionEval | null)[]): number[] {
  const out = new Set<number>()
  moves.forEach((m, i) => {
    if (!m) return
    if (KEY_MOMENTS.includes(m.classification)) out.add(m.ply)
    const a = positions[i]
    const b = positions[i + 1]
    if (a && b && Math.abs(winPercent(a.score) - winPercent(b.score)) >= 15) out.add(m.ply)
  })
  return [...out].sort((a, b) => a - b)
}

/**
 * Tạo puzzle từ vị trí trước nước sai: lời giải = nước tốt nhất của engine, và đi tiếp
 * khi các nước sau vẫn mang tính ép buộc (chiếu/ăn quân), tối đa 3 nước của mình.
 * Chỉ tạo khi lời giải rõ ràng: nước tốt nhất hơn nước thứ 2 ít nhất `minGap` Win%.
 */
export function puzzleFrom(
  fen: string,
  before: PositionEval,
  color: 'w' | 'b',
  minGap = 10
): { solution: string[]; motifs: string[] } | null {
  const [l1, l2] = before.lines
  if (!l1 || l1.pv.length === 0) return null
  if (l2 && winFor(l1.score, color) - winFor(l2.score, color) < minGap) return null
  const pv = l1.pv
  const solution = [pv[0]!]
  const sans = pvToSan(fen, pv)
  for (let j = 1; j + 1 < sans.length && solution.length < 5; j += 2) {
    const mine = sans[j + 1]!
    if (!/[x+#]/.test(mine)) break // chỉ tiếp tục khi nước kế tiếp của mình là ép buộc
    solution.push(pv[j]!, pv[j + 1]!)
  }
  const motifs = [...new Set(lineMotifs(fen, solution, solution.length).filter((m) => m.side === color).map((m) => m.kind))]
  return { solution, motifs }
}
