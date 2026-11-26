/**
 * "Nước đi tốt nhất và vì sao nó tốt" — giải thích bằng LUẬT (không cần Gemini, miễn phí, tức thì).
 * Mọi lý do đều suy ra từ dữ liệu engine + kiểm tra trên bàn cờ, không đoán mò.
 */
import type { MoveAnalysis, PositionEval } from '../types'
import { winFor } from './winPercent'
import { formatLine, fromFen, isCapture, opposite, parseUci, pieceLabel, playUci, pvToSan, ROLE_NAMES_VI } from '../chess/position'
import { hangingPieces, seeMove } from '../chess/see'
import { lineMotifs, MOTIF_VI, type Motif } from '../tactics'

export interface BestReason {
  text: string
  /** Ô liên quan để tô sáng trên bàn cờ (nếu có). */
  squares?: string[]
}

export interface BestMoveInfo {
  san: string
  uci: string
  /** Người chơi đã đi đúng nước tốt nhất. */
  isPlayed: boolean
  /** Biến chính của engine bắt đầu bằng nước tốt nhất, dạng "12. Nf3 Nc6 13. d4". */
  line: string
  /** Chuỗi UCI của biến chính (để đi thử trên bàn cờ). */
  pv: string[]
  /** Win% (góc nhìn người đi) nếu đi nước tốt nhất / nước đã đi. */
  winBest: number
  winPlayed: number
  reasons: BestReason[]
}

const sqName = (s: number): string => 'abcdefgh'[s & 7]! + String((s >> 3) + 1)

export function bestMoveInfo(fenBefore: string, playedUci: string, ma: MoveAnalysis, before: PositionEval | null): BestMoveInfo | null {
  if (!before) return null
  const line0 = before.lines[0]
  const uci = ma.bestUci ?? line0?.pv[0]
  if (!uci) return null
  const pos = fromFen(fenBefore)
  const move = parseUci(uci)
  const played = playUci(fenBefore, uci)
  if (!move || !('from' in move) || !played) return null

  const mover = pos.turn
  const color = mover === 'white' ? 'w' : 'b'
  const pv = line0 && line0.pv[0] === uci ? line0.pv : [uci]
  const sans = pvToSan(fenBefore, pv, 10)
  const reasons: BestReason[] = []
  const role = pos.board.getRole(move.from)!
  const from = sqName(move.from)
  const castling = pos.board.getColor(move.to) === mover

  // 1. Chiếu hết / chiếu
  if (played.san.includes('#')) reasons.push({ text: 'Chiếu hết ngay lập tức — kết thúc ván.', squares: [sqName(move.to)] })
  else if (played.san.includes('+')) reasons.push({ text: 'Nước chiếu: đối thủ buộc phải đối phó, bạn giữ thế chủ động.', squares: [sqName(move.to)] })

  // 2. Ăn quân / thí quân (theo SEE)
  if (!castling) {
    const see = seeMove(pos.board, move)
    const captured = pos.board.getRole(move.to)
    if (isCapture(pos, move)) {
      const name = captured ? ROLE_NAMES_VI[captured] : 'tốt'
      if (see >= 0) reasons.push({ text: `Ăn ${name} ở ${sqName(move.to)}${see > 0 ? ` — lãi khoảng ${see} điểm vật chất sau khi đổi quân` : ' — đổi quân ngang giá có lợi về thế cờ'}.`, squares: [sqName(move.to)] })
      else if (see <= -2) reasons.push({ text: `Thí ${ROLE_NAMES_VI[role]} (mất khoảng ${-see} điểm vật chất) để đổi lấy thế tấn công — engine vẫn đánh giá đây là nước tốt nhất.`, squares: [sqName(move.to)] })
    } else if (see <= -2) {
      reasons.push({ text: `Thí ${ROLE_NAMES_VI[role]}: đặt quân vào ô bị tấn công nhưng đối thủ ăn sẽ gặp bất lợi.`, squares: [sqName(move.to)] })
    }
  }

  // 3. Cứu quân đang bị treo
  const hungBefore = hangingPieces(pos.board, mover)
  if (hungBefore.length > 0) {
    const after = fromFen(played.fen)
    const hungAfter = new Set(hangingPieces(after.board, mover).map((h) => h.square))
    for (const h of hungBefore) {
      if (h.square === move.from && !hungAfter.has(move.to)) {
        reasons.push({ text: `Đưa ${pieceLabel(h.role, h.square)} đang bị treo ra chỗ an toàn.`, squares: [sqName(h.square), sqName(move.to)] })
      } else if (h.square !== move.from && !hungAfter.has(h.square)) {
        reasons.push({ text: `Bảo vệ ${pieceLabel(h.role, h.square)} đang bị treo (trước đó đối thủ ăn được ${h.loss} điểm).`, squares: [sqName(h.square)] })
      }
    }
  }

  // 4. Motif chiến thuật trong biến của nước tốt nhất (của chính người đi)
  const own = lineMotifs(fenBefore, pv, 5).filter((m) => m.side === color)
  for (const m of dedupe(own)) reasons.push({ text: `${MOTIF_VI[m.kind]}: ${m.text}.`, squares: m.squares })

  // 5. So với nước đã đi: những đe dọa của đối thủ mà nước tốt nhất tránh được
  if (playedUci !== uci && ma.motifs.threats.length > 0) {
    const threatsAfterBest = new Set(
      lineMotifs(played.fen, pv.slice(1), 3)
        .filter((m) => m.side !== color)
        .map((m) => m.kind)
    )
    const avoided = dedupe(ma.motifs.threats).filter((t) => !threatsAfterBest.has(t.kind))
    for (const t of avoided) reasons.push({ text: `Tránh được đòn của đối thủ — ${MOTIF_VI[t.kind]}: ${t.text}.`, squares: t.squares })
  }

  // 6. Ý đồ chiến lược đơn giản (khi chưa có lý do chiến thuật nào)
  if (reasons.length === 0) {
    if (castling) reasons.push({ text: 'Nhập thành: đưa vua vào nơi an toàn và kết nối hai xe.' })
    else if ((role === 'knight' || role === 'bishop') && (move.from >> 3 === (mover === 'white' ? 0 : 7))) {
      reasons.push({ text: `Phát triển ${ROLE_NAMES_VI[role]} từ ${from}, tăng kiểm soát trung tâm.`, squares: [from, sqName(move.to)] })
    } else if (role === 'pawn' && [27, 28, 35, 36].includes(move.to)) {
      reasons.push({ text: 'Chiếm trung tâm bằng tốt.', squares: [sqName(move.to)] })
    } else if (role === 'pawn' && passedPawn(played.fen, move.to, mover)) {
      reasons.push({ text: 'Đẩy tốt thông (passed pawn) tiến về phía phong cấp.', squares: [sqName(move.to)] })
    }
  }

  const winBest = winFor(before.score, color)
  return {
    san: played.san,
    uci,
    isPlayed: playedUci === uci,
    line: formatLine(fenBefore, sans),
    pv,
    winBest,
    winPlayed: ma.winAfter,
    reasons
  }
}

function dedupe(ms: Motif[]): Motif[] {
  const seen = new Set<string>()
  return ms.filter((m) => {
    const k = `${m.kind}:${m.squares.join(',')}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Tốt ở ô `sq` có phải tốt thông không (không còn tốt đối phương chặn phía trước / hai cột bên). */
function passedPawn(fen: string, square: number, color: 'white' | 'black'): boolean {
  const board = fromFen(fen).board
  const enemyPawns = board.pieces(opposite(color), 'pawn')
  const file = square & 7
  const rank = square >> 3
  for (const s of enemyPawns) {
    const f = s & 7
    const r = s >> 3
    if (Math.abs(f - file) <= 1 && (color === 'white' ? r > rank : r < rank)) return false
  }
  return true
}
