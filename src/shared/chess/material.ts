import type { Board } from 'chessops/board'
import type { Color, Role } from 'chessops/types'

/** Giá trị quân theo đơn vị tốt (dùng cho SEE, motif, vật chất). Vua lớn để không bao giờ "đổi". */
export const VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 }

export interface MaterialCount {
  pawn: number
  knight: number
  bishop: number
  rook: number
  queen: number
  /** Tổng điểm (không tính vua). */
  points: number
}

export function materialOf(board: Board, color: Color): MaterialCount {
  const m: MaterialCount = { pawn: 0, knight: 0, bishop: 0, rook: 0, queen: 0, points: 0 }
  for (const role of ['pawn', 'knight', 'bishop', 'rook', 'queen'] as const) {
    m[role] = board.pieces(color, role).size()
    m.points += m[role] * VALUE[role]
  }
  return m
}

/** Mô tả vật chất cho prompt, ví dụ "Trắng 39 (Q, 2R, 2B, 2N, 8P) vs Đen 36 (...)". */
export function describeMaterial(board: Board): string {
  const fmt = (c: Color): string => {
    const m = materialOf(board, c)
    const parts = [
      m.queen && `${m.queen > 1 ? m.queen : ''}Q`,
      m.rook && `${m.rook > 1 ? m.rook : ''}R`,
      m.bishop && `${m.bishop > 1 ? m.bishop : ''}B`,
      m.knight && `${m.knight > 1 ? m.knight : ''}N`,
      m.pawn && `${m.pawn}P`
    ].filter(Boolean)
    return `${m.points} (${parts.join(', ') || 'chỉ còn vua'})`
  }
  return `Trắng ${fmt('white')} — Đen ${fmt('black')}`
}

/** Số quân trên bàn (kể cả vua) — dùng để biết có tra tablebase được không (≤ 7). */
export function pieceCount(board: Board): number {
  return board.occupied.size()
}
