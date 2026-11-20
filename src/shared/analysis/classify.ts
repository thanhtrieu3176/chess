/** Phân loại nước đi. Ngưỡng là hằng số trong THRESHOLDS (đơn vị: điểm Win%, thang 0–100). */

export type Classification =
  | 'book'
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'

export const CLASSIFICATIONS: Classification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder'
]

export const THRESHOLDS = {
  /** Mất < 2 Win%: Excellent. */
  excellent: 2,
  /** Mất < 5: Good. Từ 5 trở lên là Inaccuracy (Lichess: 0.1 trên thang [−1,1] = 5 Win%). */
  good: 5,
  /** Từ 10: Mistake (Lichess 0.2). */
  mistake: 10,
  /** Từ 15: Blunder (Lichess 0.3). */
  blunder: 15,
  /** Great: nước tốt thứ 2 kém nước tốt nhất ít nhất chừng này. */
  greatGap: 15,
  /** Brilliant: chỉ khi thế cờ trước đó chưa thắng tuyệt đối. */
  brilliantMaxWinBefore: 90,
  /** Brilliant: sau nước thí vẫn phải giữ được thế cờ ít nhất cân bằng. */
  brilliantMinWinAfter: 45,
  /** Brilliant: thí ít nhất chừng này điểm vật chất (2 = hơn 1 tốt, tức quân nhẹ trở lên). */
  sacrificeMin: 2,
  /** Miss: nước tốt nhất cho Win% ≥ ngưỡng này (cơ hội thắng rõ)... */
  missOpportunity: 70,
  /** ...và nước đã đi mất ít nhất chừng này. */
  missLoss: 10
} as const

export interface ClassifyInput {
  /** Win% (góc nhìn người đi) nếu chơi nước tốt nhất = đánh giá vị trí trước nước đi. */
  winBefore: number
  /** Win% (góc nhìn người đi) sau nước đã đi. */
  winAfter: number
  playedUci: string
  bestUci: string | null
  /** Win% (góc nhìn người đi) nếu chơi nước tốt thứ 2 (cần MultiPV ≥ 2). */
  secondBestWin?: number
  /** Vị trí sau nước đi có trong dữ liệu khai cuộc. */
  isBook: boolean
  /** Nước đi thí ≥ THRESHOLDS.sacrificeMin điểm vật chất (theo SEE). */
  sacrifice: boolean
  /** Nước ăn lại hiển nhiên (ăn trả quân vừa bị ăn trên cùng ô) — không tính là Great. */
  isRecapture: boolean
  /** Chỉ có 1 nước hợp lệ — không tính là Great. */
  forced: boolean
  /** Phân loại nước liền trước của đối thủ (để nhận diện Miss). */
  prevOpponent?: Classification | null
  /**
   * Kết quả tablebase (góc nhìn người đi) trước và sau nước đi, nếu có (≤ 7 quân).
   * Khi có thì ưu tiên hơn điểm engine.
   */
  tablebase?: { before: TbOutcome; after: TbOutcome }
}

export type TbOutcome = 'win' | 'draw' | 'loss'

const TB_RANK: Record<TbOutcome, number> = { loss: 0, draw: 1, win: 2 }

export function classify(i: ClassifyInput): Classification {
  const isBest = i.bestUci !== null && i.playedUci === i.bestUci
  const loss = Math.max(0, i.winBefore - i.winAfter)

  if (i.isBook) return 'book'

  if (i.tablebase) {
    const drop = TB_RANK[i.tablebase.before] - TB_RANK[i.tablebase.after]
    if (drop >= 2 || (drop === 1 && i.tablebase.after === 'loss')) return 'blunder'
    if (drop === 1) return 'mistake' // thắng → hòa
    return isBest ? 'best' : 'excellent' // giữ nguyên kết quả lý thuyết
  }

  if (
    i.sacrifice &&
    loss < THRESHOLDS.excellent &&
    i.winBefore < THRESHOLDS.brilliantMaxWinBefore &&
    i.winAfter >= THRESHOLDS.brilliantMinWinAfter
  ) {
    return 'brilliant'
  }

  if (
    isBest &&
    !i.isRecapture &&
    !i.forced &&
    i.secondBestWin !== undefined &&
    i.winBefore - i.secondBestWin >= THRESHOLDS.greatGap
  ) {
    return 'great'
  }

  if (isBest) return 'best'

  if (
    (i.prevOpponent === 'mistake' || i.prevOpponent === 'blunder') &&
    i.winBefore >= THRESHOLDS.missOpportunity &&
    loss >= THRESHOLDS.missLoss &&
    i.winAfter < THRESHOLDS.missOpportunity
  ) {
    return 'miss'
  }

  if (loss < THRESHOLDS.excellent) return 'excellent'
  if (loss < THRESHOLDS.good) return 'good'
  if (loss < THRESHOLDS.mistake) return 'inaccuracy'
  if (loss < THRESHOLDS.blunder) return 'mistake'
  return 'blunder'
}

/** Các loại "khoảnh khắc quan trọng": tự giải thích, phân tích sâu ở lượt 2, tạo puzzle. */
export const KEY_MOMENTS: Classification[] = ['brilliant', 'great', 'mistake', 'miss', 'blunder']
export const ERRORS: Classification[] = ['inaccuracy', 'mistake', 'miss', 'blunder']

export const CLASS_INFO: Record<Classification, { vi: string; symbol: string; color: string }> = {
  brilliant: { vi: 'Xuất sắc', symbol: '!!', color: '#1baca6' },
  great: { vi: 'Nước duy nhất', symbol: '!', color: '#5c8bb0' },
  best: { vi: 'Tốt nhất', symbol: '★', color: '#81b64c' },
  excellent: { vi: 'Rất tốt', symbol: '👍', color: '#96bc4b' },
  good: { vi: 'Tốt', symbol: '✓', color: '#97af8b' },
  book: { vi: 'Lý thuyết', symbol: '📖', color: '#a88865' },
  inaccuracy: { vi: 'Thiếu chính xác', symbol: '?!', color: '#f7c045' },
  mistake: { vi: 'Sai lầm', symbol: '?', color: '#e58f2a' },
  miss: { vi: 'Bỏ lỡ', symbol: '✗', color: '#ee6b55' },
  blunder: { vi: 'Sai lầm nghiêm trọng', symbol: '??', color: '#ca3431' }
}
