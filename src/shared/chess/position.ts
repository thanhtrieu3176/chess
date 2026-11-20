import { Chess, type Position } from 'chessops/chess'
import { makeFen, parseFen } from 'chessops/fen'
import { makeSan, makeSanAndPlay, parseSan } from 'chessops/san'
import { makeUci, parseUci, parseSquare } from 'chessops/util'
import type { Color, Move, Role, Square } from 'chessops/types'

/** Tạo Position từ FEN. Ném lỗi nếu FEN không hợp lệ. */
export function fromFen(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap()
}

export function toFen(pos: Position): string {
  return makeFen(pos.toSetup())
}

export function isValidFen(fen: string): boolean {
  const setup = parseFen(fen.trim())
  return setup.isOk && Chess.fromSetup(setup.unwrap()).isOk
}

/** Đổi nước UCI sang SAN tại vị trí cho trước; null nếu không hợp lệ. */
export function uciToSan(fen: string, uci: string): string | null {
  const pos = fromFen(fen)
  const move = parseUci(uci)
  if (!move || !pos.isLegal(move)) return null
  return makeSan(pos, move)
}

/** Đổi cả chuỗi nước UCI (PV của engine) sang SAN; dừng ở nước không hợp lệ đầu tiên. */
export function pvToSan(fen: string, pv: string[], max = pv.length): string[] {
  const pos = fromFen(fen)
  const out: string[] = []
  for (const uci of pv.slice(0, max)) {
    const move = parseUci(uci)
    if (!move || !pos.isLegal(move)) break
    out.push(makeSanAndPlay(pos, move))
  }
  return out
}

/** Định dạng PV kiểu "12. Nf3 Nc6 13. d4" bắt đầu từ vị trí `fen`. */
export function formatLine(fen: string, sans: string[]): string {
  const pos = fromFen(fen)
  let num = pos.fullmoves
  let white = pos.turn === 'white'
  const parts: string[] = []
  sans.forEach((san, i) => {
    if (white) parts.push(`${num}. ${san}`)
    else parts.push(i === 0 ? `${num}... ${san}` : san)
    if (!white) num++
    white = !white
  })
  return parts.join(' ')
}

/** Chơi nước SAN, trả về UCI và FEN mới; null nếu không hợp lệ. */
export function playSan(fen: string, san: string): { uci: string; fen: string; san: string } | null {
  const pos = fromFen(fen)
  const move = parseSan(pos, san)
  if (!move) return null
  const sanNorm = makeSanAndPlay(pos, move)
  return { uci: makeUci(move), fen: toFen(pos), san: sanNorm }
}

/** Chơi nước UCI, trả về SAN và FEN mới; null nếu không hợp lệ. */
export function playUci(fen: string, uci: string): { uci: string; fen: string; san: string } | null {
  const pos = fromFen(fen)
  const move = parseUci(uci)
  if (!move || !pos.isLegal(move)) return null
  const san = makeSanAndPlay(pos, move)
  return { uci, fen: toFen(pos), san }
}

export const colorChar = (c: Color): 'w' | 'b' => (c === 'white' ? 'w' : 'b')
export const charColor = (c: 'w' | 'b'): Color => (c === 'w' ? 'white' : 'black')
export const opposite = (c: Color): Color => (c === 'white' ? 'black' : 'white')

export function squareName(sq: Square): string {
  return 'abcdefgh'[sq & 7]! + String((sq >> 3) + 1)
}

export function sq(name: string): Square {
  const s = parseSquare(name)
  if (s === undefined) throw new Error(`Ô không hợp lệ: ${name}`)
  return s
}

export const ROLE_NAMES_VI: Record<Role, string> = {
  pawn: 'tốt',
  knight: 'mã',
  bishop: 'tượng',
  rook: 'xe',
  queen: 'hậu',
  king: 'vua'
}

export const ROLE_LETTER: Record<Role, string> = {
  pawn: '',
  knight: 'N',
  bishop: 'B',
  rook: 'R',
  queen: 'Q',
  king: 'K'
}

/** Mô tả quân + ô, ví dụ "Nf3" hoặc "tốt e5" — ngắn gọn cho dữ liệu motif. */
export function pieceLabel(role: Role, square: Square): string {
  return role === 'pawn' ? `tốt ${squareName(square)}` : `${ROLE_LETTER[role]}${squareName(square)}`
}

/** Nước đi hiện tại có phải nước bắt quân không. */
export function isCapture(pos: Position, move: Move): boolean {
  if (!('from' in move)) return false
  return pos.board.occupied.has(move.to) || (pos.board.getRole(move.from) === 'pawn' && (move.from & 7) !== (move.to & 7))
}

export function legalMoveCount(pos: Position): number {
  let n = 0
  for (const [, dests] of pos.allDests()) n += dests.size()
  return n
}

/** Tất cả nước hợp lệ (phong cấp chỉ tính các quân hậu/xe/tượng/mã). */
export function legalMoves(pos: Position): Move[] {
  const moves: Move[] = []
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const promo = pos.board.getRole(from) === 'pawn' && (to >> 3 === 0 || to >> 3 === 7)
      if (promo) for (const p of ['queen', 'rook', 'bishop', 'knight'] as const) moves.push({ from, to, promotion: p })
      else moves.push({ from, to })
    }
  }
  return moves
}

export { makeUci, parseUci }
