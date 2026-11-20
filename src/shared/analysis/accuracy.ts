/**
 * Accuracy theo cách của Lichess (lila: modules/analyse/AccuracyPercent.scala).
 *
 * Mỗi nước: accuracy = 103.1668 · exp(−0.04354 · (winBefore − winAfter)) − 3.1669 + 1
 *   - winBefore/winAfter: Win% theo góc nhìn người đi, trước và sau nước đi.
 *   - "+1" là "uncertainty bonus" Lichess cộng thêm: tránh accuracy = 0 tuyệt đối
 *     (làm trung bình điều hòa sụp về 0 chỉ vì 1 nước). Kết quả kẹp trong [0, 100].
 *
 * Cả ván (mỗi bên):
 *   1. Dãy Win% (góc nhìn Trắng) của mọi vị trí.
 *   2. Cửa sổ trượt kích thước clamp(số nước / 10, 2, 8). Trọng số của nước i = độ lệch chuẩn
 *      Win% trong cửa sổ, kẹp [0.5, 12]: thế cờ đang biến động → nước đó "quan trọng" hơn.
 *   3. Accuracy bên = (trung bình có trọng số + trung bình điều hòa) / 2.
 *      Trung bình điều hòa phạt nặng vài nước rất tệ, trung bình trọng số phản ánh độ ổn định chung.
 */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100
  const raw = 103.1668 * Math.exp(-0.04354 * (winBefore - winAfter)) - 3.1669 + 1
  return Math.max(0, Math.min(100, raw))
}

function stdDev(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length)
}

/**
 * @param wins Win% góc nhìn Trắng của các vị trí 0..n (n = số nước).
 * @param firstMover Bên đi nước đầu tiên (thường là Trắng, khác nếu ván bắt đầu từ FEN).
 */
export function gameAccuracy(wins: number[], firstMover: 'w' | 'b' = 'w'): { w: number | null; b: number | null } {
  const n = wins.length - 1
  if (n < 1) return { w: null, b: null }
  const windowSize = Math.max(2, Math.min(8, Math.floor(n / 10)))
  const size = Math.min(windowSize, wins.length)
  // Lichess: (size − 2) cửa sổ đầu lặp lại cửa sổ đầu tiên, sau đó trượt bình thường → đủ n cửa sổ.
  const windows: number[][] = []
  for (let i = 0; i < size - 2; i++) windows.push(wins.slice(0, size))
  for (let i = 0; i + size <= wins.length; i++) windows.push(wins.slice(i, i + size))
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, stdDev(w))))

  const per: Record<'w' | 'b', { acc: number; weight: number }[]> = { w: [], b: [] }
  for (let i = 0; i < n; i++) {
    const color: 'w' | 'b' = (i % 2 === 0) === (firstMover === 'w') ? 'w' : 'b'
    const before = color === 'w' ? wins[i]! : 100 - wins[i]!
    const after = color === 'w' ? wins[i + 1]! : 100 - wins[i + 1]!
    per[color].push({ acc: moveAccuracy(before, after), weight: weights[i] ?? 0.5 })
  }

  const combine = (xs: { acc: number; weight: number }[]): number | null => {
    if (xs.length === 0) return null
    const wsum = xs.reduce((a, x) => a + x.weight, 0)
    const weighted = xs.reduce((a, x) => a + x.acc * x.weight, 0) / wsum
    const harmonic = xs.length / xs.reduce((a, x) => a + 1 / Math.max(x.acc, 0.001), 0)
    return (weighted + harmonic) / 2
  }
  return { w: combine(per.w), b: combine(per.b) }
}
