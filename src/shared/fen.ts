/**
 * Chuẩn hóa FEN để làm khóa cache: bỏ 2 trường cuối (halfmove clock, fullmove number)
 * vì chúng không ảnh hưởng tới đánh giá vị trí (trừ luật 50 nước, bỏ qua ở đây).
 * Ô en passant chỉ giữ lại nếu thực sự có tốt có thể bắt qua đường; chessops đã làm việc đó
 * khi sinh FEN, nên ở đây chỉ cắt chuỗi.
 */
export function normalizeFen(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(' ')
}

/** Bên đi trong FEN: 'w' hoặc 'b'. */
export function sideToMove(fen: string): 'w' | 'b' {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w'
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
