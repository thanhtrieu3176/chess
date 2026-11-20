import type { Board } from 'chessops/board'
import { bishopAttacks, kingAttacks, knightAttacks, pawnAttacks, rookAttacks } from 'chessops/attacks'
import { SquareSet } from 'chessops/squareSet'
import type { Color, NormalMove, Role, Square } from 'chessops/types'
import { VALUE } from './material'
import { opposite } from './position'

/**
 * Các quân của `color` tấn công ô `square`, với tập ô bị chiếm `occupied`
 * (truyền occupied đã bỏ bớt quân để tính tia X — quân đứng sau quân vừa ăn).
 */
export function attackersTo(board: Board, square: Square, color: Color, occupied: SquareSet = board.occupied): SquareSet {
  const own = board[color].intersect(occupied)
  return rookAttacks(square, occupied)
    .intersect(board.rook.union(board.queen))
    .union(bishopAttacks(square, occupied).intersect(board.bishop.union(board.queen)))
    .union(knightAttacks(square).intersect(board.knight))
    .union(kingAttacks(square).intersect(board.king))
    .union(pawnAttacks(opposite(color), square).intersect(board.pawn))
    .intersect(own)
}

function leastValuable(board: Board, set: SquareSet): Square | undefined {
  let best: Square | undefined
  let bestValue = Infinity
  for (const s of set) {
    const v = VALUE[board.getRole(s)!]
    if (v < bestValue) {
      bestValue = v
      best = s
    }
  }
  return best
}

/**
 * SEE: lợi ích vật chất (đơn vị tốt) mà `side` thu được khi bắt quân đứng ở `square`
 * rồi hai bên lần lượt ăn lại bằng quân rẻ nhất, mỗi bên được quyền dừng khi bất lợi.
 * Trả 0 nếu `side` không có quân nào tấn công ô đó, hoặc ô trống.
 *
 * Thuật toán "swap list" chuẩn: gain[d] = giá trị quân vừa bị bắt − gain[d−1],
 * rồi lan ngược để mỗi bên chọn dừng hay tiếp tục.
 * Bỏ qua ghim (SEE là đánh giá tĩnh) — đủ tốt để phát hiện quân treo / thí quân.
 */
export function seeCapture(board: Board, square: Square, side: Color): number {
  const target = board.getRole(square)
  if (!target) return 0
  let occupied = board.occupied
  let color = side
  let attacker = leastValuable(board, attackersTo(board, square, color, occupied))
  if (attacker === undefined) return 0

  const gain: number[] = [VALUE[target]]
  let d = 0
  let onSquare = board.getRole(attacker)! // quân đang đứng trên ô sau mỗi lần ăn
  while (true) {
    occupied = occupied.without(attacker)
    color = opposite(color)
    const next = leastValuable(board, attackersTo(board, square, color, occupied))
    if (next === undefined) break
    // Vua không được ăn vào ô vẫn còn bị tấn công.
    if (board.getRole(next) === 'king' && attackersTo(board, square, opposite(color), occupied.without(next)).nonEmpty()) break
    d++
    gain[d] = VALUE[onSquare] - gain[d - 1]!
    onSquare = board.getRole(next)!
    attacker = next
  }
  while (d > 0) {
    gain[d - 1] = -Math.max(-gain[d - 1]!, gain[d]!)
    d--
  }
  return gain[0]!
}

/**
 * SEE của một nước đi thường (from → to): vật chất `mover` lãi/lỗ sau khi đối phương
 * ăn lại tốt nhất trên ô đích. Âm nghĩa là nước đi "thí" quân.
 */
export function seeMove(board: Board, move: NormalMove): number {
  const piece = board.get(move.from)
  if (!piece || board.getColor(move.to) === piece.color) return 0 // nhập thành (vua → ô xe)
  const captured = board.getRole(move.to)
  // Bắt tốt qua đường: ô đích trống nhưng vẫn ăn được 1 tốt.
  const enPassant = piece.role === 'pawn' && !captured && (move.from & 7) !== (move.to & 7)
  const after = board.clone()
  after.take(move.to)
  after.take(move.from)
  if (enPassant) after.take(move.to + (piece.color === 'white' ? -8 : 8))
  after.set(move.to, { color: piece.color, role: move.promotion ?? piece.role })
  const gained = (captured ? VALUE[captured] : enPassant ? 1 : 0) + (move.promotion ? VALUE[move.promotion] - 1 : 0)
  return gained - Math.max(0, seeCapture(after, move.to, opposite(piece.color)))
}

/** Quân đang bị treo: đối phương ăn được và có lãi (theo SEE). Không tính vua. */
export function hangingPieces(board: Board, color: Color): { square: Square; role: Role; loss: number }[] {
  const out: { square: Square; role: Role; loss: number }[] = []
  for (const s of board[color].diff(board.king)) {
    const loss = seeCapture(board, s, opposite(color))
    if (loss > 0) out.push({ square: s, role: board.getRole(s)!, loss })
  }
  return out
}
