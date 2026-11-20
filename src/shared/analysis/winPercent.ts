import type { Score } from '../types'

/** Giới hạn cp khi quy đổi (giống Lichess): ±1000. Điểm mate quy về giới hạn này. */
export const CP_CEILING = 1000

/** cp tương đương của một điểm số (góc nhìn Trắng). Mate → ±CP_CEILING. */
export function scoreToCp(s: Score): number {
  if (s.mate !== undefined) return s.mate > 0 ? CP_CEILING : s.mate < 0 ? -CP_CEILING : 0
  return Math.max(-CP_CEILING, Math.min(CP_CEILING, s.cp ?? 0))
}

/**
 * Tỷ lệ thắng (0–100) của bên Trắng, công thức Lichess:
 *   Win% = 50 + 50 · (2 / (1 + exp(−0.00368208 · cp)) − 1)
 * Mate quy về ±1000cp (≈ 97,5%). Vị trí đã bị chiếu hết (cp ±100000) = 100% / 0%.
 */
export function winPercent(s: Score): number {
  // Ván đã kết thúc bằng chiếu hết (engine trả ±100000): thắng/thua tuyệt đối.
  if (s.cp !== undefined && Math.abs(s.cp) >= 100000) return s.cp > 0 ? 100 : 0
  const cp = scoreToCp(s)
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

/** Win% theo góc nhìn một bên. */
export function winFor(s: Score, color: 'w' | 'b'): number {
  const w = winPercent(s)
  return color === 'w' ? w : 100 - w
}

/** Định dạng điểm số: "+1.25", "−0.40", "#3", "#-2". */
export function formatScore(s: Score | null | undefined): string {
  if (!s) return '—'
  if (s.mate !== undefined) return `#${s.mate}`
  const cp = s.cp ?? 0
  if (Math.abs(cp) >= 100000) return cp > 0 ? '1-0' : '0-1'
  const v = cp / 100
  return (v > 0 ? '+' : '') + v.toFixed(2)
}
