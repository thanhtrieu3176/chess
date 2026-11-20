/**
 * Dựng phần DỮ LIỆU cho prompt từ kết quả engine + motif + khai cuộc + tablebase.
 * Mỗi hàm trả về văn bản dữ liệu và tập nước SAN được phép nhắc tới (dùng cho hậu kiểm).
 */
import type { GameDetail, MoveAnalysis, PositionEval, Stats } from '@shared/types'
import { CLASS_INFO } from '@shared/analysis/classify'
import { formatScore } from '@shared/analysis/winPercent'
import { formatLine, fromFen, pvToSan } from '@shared/chess/position'
import { describeMaterial } from '@shared/chess/material'
import { PHASE_VI } from '@shared/chess/phase'
import { positionMotifs, MOTIF_VI, type Motif } from '@shared/tactics'
import { nextBookMoves, openingAt, type Opening } from '@shared/openings'

export interface PromptData {
  text: string
  allowed: Set<string>
}

const side = (c: 'w' | 'b'): string => (c === 'w' ? 'Trắng' : 'Đen')

function motifLines(title: string, ms: Motif[]): string {
  if (ms.length === 0) return `${title}: (không phát hiện)`
  return `${title}:\n${ms.map((m) => `  - ${MOTIF_VI[m.kind]} [${side(m.side)} hưởng lợi]: ${m.text}`).join('\n')}`
}

function linesBlock(fen: string, ev: PositionEval | null, allowed: Set<string>, max = 3): string {
  if (!ev || ev.lines.length === 0) return '  (không có)'
  return ev.lines
    .slice(0, max)
    .map((l, i) => {
      const sans = pvToSan(fen, l.pv, 8)
      sans.forEach((s) => allowed.add(s))
      return `  ${i + 1}) ${formatScore(l.score)}: ${formatLine(fen, sans)}`
    })
    .join('\n')
}

function perspective(detail: GameDetail, name: string): string {
  const c = detail.row.userColor
  return c ? `${name} cầm quân ${side(c)}.` : `Đây KHÔNG phải ván của ${name} (xem trung lập).`
}

/** Dữ liệu của một nước đi trong ván. */
export function moveData(detail: GameDetail, ply: number, name: string): PromptData {
  const a = detail.analysis
  const m = detail.moves[ply - 1]
  const ma = a?.moves[ply - 1]
  if (!m || !a || !ma) throw new Error('Nước này chưa được phân tích')
  const allowed = new Set<string>([m.san])
  const before = a.positions[ply - 1] ?? null
  const after = a.positions[ply] ?? null
  const opening = detail.openings[ply]
  const owner = detail.row.userColor ? (m.color === detail.row.userColor ? `của ${name}` : 'của đối thủ') : ''
  if (ma.bestSan) allowed.add(ma.bestSan)
  const tb = before?.tablebase
  const text = [
    `Ván: ${detail.row.white} (Trắng) vs ${detail.row.black} (Đen), kết quả ${detail.row.result}. ${perspective(detail, name)}`,
    `Khai cuộc: ${opening ? `${opening.name} (${opening.eco})` : 'không rõ'}. Giai đoạn: ${PHASE_VI[ma.phase]}.`,
    `Nước đang xét: ${formatLine(m.fenBefore, [m.san])} — ${side(m.color)} đi, nước ${owner}.`,
    `FEN trước nước đi: ${m.fenBefore}`,
    `Vật chất: ${describeMaterial(fromFen(m.fenBefore).board)}`,
    `Điểm engine trước nước đi (góc nhìn Trắng): ${formatScore(before?.score)}; sau nước đi: ${formatScore(after?.score)}.`,
    `Tỷ lệ thắng của bên đi: ${ma.winBefore.toFixed(1)}% → ${ma.winAfter.toFixed(1)}% (mất ${Math.max(0, ma.winBefore - ma.winAfter).toFixed(1)} điểm).`,
    `Phân loại: ${CLASS_INFO[ma.classification].vi} (${ma.classification}).`,
    `Nước tốt nhất theo engine: ${ma.bestSan ?? '—'}${ma.bestSan === m.san ? ' (chính là nước đã đi)' : ''}.`,
    `Các biến tốt nhất từ vị trí TRƯỚC nước đi:\n${linesBlock(m.fenBefore, before, allowed)}`,
    `Biến tốt nhất SAU nước đã đi (đối thủ đáp trả):\n${linesBlock(m.fenAfter, after, allowed, 1)}`,
    motifLines('Motif do nước đã đi tạo ra', ma.motifs.played),
    motifLines('Motif trong biến tốt nhất (cơ hội)', ma.motifs.best),
    motifLines('Đe dọa của đối phương sau nước đã đi', ma.motifs.threats),
    motifLines('Đặc điểm vị trí sau nước đi', positionMotifs(fromFen(m.fenAfter)).filter((x) => x.kind !== 'pin' || x.text.includes('tuyệt đối'))),
    tb && tb.category !== 'unknown'
      ? `Tablebase (vị trí trước nước đi, góc nhìn bên đi): ${tb.category === 'win' ? 'thắng' : tb.category === 'loss' ? 'thua' : 'hòa'}${tb.dtm ? `, chiếu hết sau ${Math.abs(tb.dtm)} nửa nước` : ''}${tb.bestSan ? `, nước tốt nhất ${tb.bestSan}` : ''}.`
      : ''
  ]
  if (tb?.bestSan) allowed.add(tb.bestSan)
  return { text: text.filter(Boolean).join('\n'), allowed }
}

/** Dữ liệu tóm tắt cả ván: chỉ các khoảnh khắc quan trọng + accuracy. */
export function gameData(detail: GameDetail, name: string): PromptData {
  const a = detail.analysis
  if (!a) throw new Error('Ván chưa được phân tích')
  const allowed = new Set<string>(detail.moves.map((m) => m.san))
  const key = a.moves.filter(
    (m): m is MoveAnalysis => !!m && ['brilliant', 'great', 'mistake', 'miss', 'blunder'].includes(m.classification)
  )
  const lines = key.map((m) => {
    const mv = detail.moves[m.ply - 1]!
    if (m.bestSan) allowed.add(m.bestSan)
    return `  - ply ${m.ply}: ${formatLine(mv.fenBefore, [mv.san])} (${side(m.color)}) — ${CLASS_INFO[m.classification].vi}, Win% bên đi ${m.winBefore.toFixed(0)}→${m.winAfter.toFixed(0)}, nước tốt nhất ${m.bestSan ?? '—'}${m.motifs.best.length ? `; motif bị bỏ lỡ: ${m.motifs.best.map((x) => MOTIF_VI[x.kind]).join(', ')}` : ''}${m.motifs.threats.length ? `; đe dọa: ${m.motifs.threats.map((x) => MOTIF_VI[x.kind]).join(', ')}` : ''}`
  })
  const opening = detail.openings.findLast((o) => o !== null)
  const text = [
    `Ván: ${detail.row.white} (Trắng) vs ${detail.row.black} (Đen), kết quả ${detail.row.result}${detail.row.termination ? ` (${detail.row.termination})` : ''}. ${perspective(detail, name)}`,
    `Khai cuộc: ${opening ? `${opening.name} (${opening.eco})` : 'không rõ'}${detail.outOfBookPly ? `, ra khỏi lý thuyết ở nửa nước ${detail.outOfBookPly}` : ''}.`,
    `Số nước: ${detail.moves.length} nửa nước. Accuracy: Trắng ${a.accuracy.w?.toFixed(1) ?? '—'}%, Đen ${a.accuracy.b?.toFixed(1) ?? '—'}%.`,
    `Toàn bộ nước đi: ${formatLine(detail.startFen, detail.moves.map((m) => m.san))}`,
    `Các khoảnh khắc quan trọng:\n${lines.join('\n') || '  (không có)'}`
  ]
  return { text: text.join('\n'), allowed }
}

/** Dữ liệu khai cuộc tại một vị trí. */
export function openingData(fen: string, fallback?: Opening | null): PromptData {
  const o = openingAt(fen) ?? fallback ?? null
  if (!o) throw new Error('Vị trí này không thuộc dữ liệu khai cuộc')
  const allowed = new Set<string>()
  o.pgn
    .split(/\s+/)
    .filter((t) => !/^\d+\./.test(t))
    .forEach((s) => allowed.add(s))
  const next = nextBookMoves(fen).slice(0, 12)
  next.forEach((n) => allowed.add(n.san))
  const text = [
    `Khai cuộc: ${o.name} (ECO ${o.eco}).`,
    `Chuỗi nước lý thuyết: ${o.pgn}`,
    `FEN: ${fen}`,
    `Các nước lý thuyết tiếp theo:\n${next.map((n) => `  - ${n.san} → ${n.opening.name}`).join('\n') || '  (không có)'}`
  ]
  return { text: text.join('\n'), allowed }
}

/** Dữ liệu thống kê (không gửi toàn bộ ván). */
export function overviewData(stats: Stats, name: string): PromptData {
  const pct = (a: number, b: number): string => (b ? `${((a / b) * 100).toFixed(0)}%` : '—')
  const text = [
    `Học trò: ${name}. Tổng ${stats.games} ván (${stats.analyzed} ván đã phân tích). Thắng/Hòa/Thua: ${stats.record.win}/${stats.record.draw}/${stats.record.loss}.`,
    `Khai cuộc thua nhiều nhất:\n${stats.openings
      .slice(0, 8)
      .map((o) => `  - ${o.family} (cầm ${side(o.color)}): ${o.games} ván, thắng ${pct(o.win, o.games)}, thua ${pct(o.loss, o.games)}, accuracy TB ${o.avgAccuracy?.toFixed(1) ?? '—'}%`)
      .join('\n')}`,
    `Theo giai đoạn:\n${stats.phases
      .map((p) => `  - ${PHASE_VI[p.phase]}: accuracy ${p.accuracy?.toFixed(1) ?? '—'}%, ${p.errorsPerGame.toFixed(2)} lỗi/ván, ${p.blundersPerGame.toFixed(2)} blunder/ván`)
      .join('\n')}`,
    `Blunder theo thời gian còn lại trên đồng hồ:\n${stats.clock
      .map((c) => `  - ${c.bucket}: ${c.moves} nước, ${c.blunders} blunder (${pct(c.blunders, c.moves)}), ${c.mistakes} mistake`)
      .join('\n')}`,
    `Motif hay bỏ lỡ: ${stats.motifsMissed.map((m) => `${MOTIF_VI[m.kind as Motif['kind']] ?? m.kind} (${m.count})`).join(', ') || '—'}`,
    `Motif hay dính: ${stats.motifsSuffered.map((m) => `${MOTIF_VI[m.kind as Motif['kind']] ?? m.kind} (${m.count})`).join(', ') || '—'}`,
    `Accuracy 10 ván gần nhất: ${stats.accuracyTrend
      .slice(-10)
      .map((t) => t.accuracy.toFixed(0))
      .join(', ')}`
  ]
  return { text: text.join('\n'), allowed: new Set() }
}

/** Dữ liệu một puzzle. */
export function puzzleData(fen: string, solution: string[], motifs: string[], playedSan: string | null, cls: string, name: string): PromptData {
  const sans = pvToSan(fen, solution)
  const allowed = new Set<string>(sans)
  if (playedSan) allowed.add(playedSan)
  const text = [
    `Bài tập tạo từ ván của ${name}. FEN: ${fen}`,
    `Bên đi: ${side(fromFen(fen).turn === 'white' ? 'w' : 'b')}.`,
    `Vật chất: ${describeMaterial(fromFen(fen).board)}`,
    `Lời giải (engine): ${formatLine(fen, sans)}`,
    `Nước ${name} đã đi trong ván: ${playedSan ?? '—'} (bị đánh giá: ${cls}).`,
    `Motif của lời giải: ${motifs.map((m) => MOTIF_VI[m as Motif['kind']] ?? m).join(', ') || '—'}`
  ]
  return { text: text.join('\n'), allowed }
}
