import type { Board } from 'chessops/board'
import { SquareSet } from 'chessops/squareSet'

export type Phase = 'opening' | 'middlegame' | 'endgame'

export const PHASE_VI: Record<Phase, string> = { opening: 'Khai cuộc', middlegame: 'Trung cuộc', endgame: 'Tàn cuộc' }

/**
 * Giai đoạn ván đấu theo lượng vật chất (đơn giản hóa từ "Divider" của Lichess):
 *  - M = tổng số quân nhẹ + quân nặng (mã, tượng, xe, hậu) của cả 2 bên (đầu ván M = 14).
 *  - Tàn cuộc: M ≤ 6.
 *  - Trung cuộc: M ≤ 10, HOẶC hàng cuối của một bên còn < 4 quân của chính bên đó
 *    (các quân đã rời vị trí xuất phát → hết giai đoạn triển khai).
 *  - Còn lại: khai cuộc.
 */
export function phaseOf(board: Board): Phase {
  const majorsAndMinors = board.occupied.diff(board.pawn).diff(board.king).size()
  if (majorsAndMinors <= 6) return 'endgame'
  const whiteBack = board.white.intersect(SquareSet.fromRank(0)).size()
  const blackBack = board.black.intersect(SquareSet.fromRank(7)).size()
  if (majorsAndMinors <= 10 || whiteBack < 4 || blackBack < 4) return 'middlegame'
  return 'opening'
}

/** Giai đoạn cho cả dãy vị trí, đảm bảo không "quay ngược" (đã trung cuộc thì không về khai cuộc). */
export function phasesOf(boards: Board[]): Phase[] {
  const order: Phase[] = ['opening', 'middlegame', 'endgame']
  let max = 0
  return boards.map((b) => {
    max = Math.max(max, order.indexOf(phaseOf(b)))
    return order[max]!
  })
}
