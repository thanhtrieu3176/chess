/**
 * Tra cứu khai cuộc từ bộ dữ liệu lichess-org/chess-openings (CC0).
 * Dữ liệu nạp vào Map<EPD, Opening> một lần khi dùng lần đầu → tra cứu O(1).
 * EPD = 4 trường đầu của FEN, nên các thứ tự nước khác nhau (transposition) vẫn khớp.
 */
import data from './openings.json'
import { normalizeFen } from '../fen'
import { fromFen, legalMoves, makeUci, toFen } from '../chess/position'
import { makeSan } from 'chessops/san'

export interface Opening {
  eco: string
  name: string
  /** Chuỗi nước lý thuyết, ví dụ "1. e4 c5 2. Nf3 d6". */
  pgn: string
}

let map: Map<string, Opening> | null = null
let book: Set<string> | null = null

function table(): Map<string, Opening> {
  if (!map) {
    const d = data as { o: [string, string, string, string][]; b: string[] }
    map = new Map()
    for (const [eco, name, pgn, epd] of d.o) {
      // Giữ tên đầu tiên khi trùng vị trí (file được sắp theo ECO).
      if (!map.has(epd)) map.set(epd, { eco, name, pgn })
    }
    book = new Set(d.b)
  }
  return map
}

/** Khai cuộc có tên tại đúng vị trí này (null nếu vị trí không có tên riêng). */
export function openingAt(fen: string): Opening | null {
  return table().get(normalizeFen(fen)) ?? null
}

/** Vị trí có thuộc lý thuyết không: có tên, hoặc nằm trên đường tới một khai cuộc có tên. */
export function isBookPosition(fen: string): boolean {
  const key = normalizeFen(fen)
  return table().has(key) || book!.has(key)
}

export interface GameOpenings {
  /** Khai cuộc "hiện hành" tại mỗi vị trí 0..n (giữ tên gần nhất đã biết). */
  current: (Opening | null)[]
  /** Vị trí i (sau nước thứ i) có còn trong lý thuyết không — liên tục từ đầu ván. */
  inBook: boolean[]
  /** Nước (ply, 1-based) đầu tiên ra khỏi sách; null nếu cả ván trong sách hoặc chưa từng vào sách. */
  outOfBookPly: number | null
}

export function openingsForGame(fens: string[]): GameOpenings {
  const current: (Opening | null)[] = []
  const inBook: boolean[] = []
  let last: Opening | null = null
  let stillBook = true
  let outOfBookPly: number | null = null
  fens.forEach((fen, i) => {
    const o = openingAt(fen)
    if (o) last = o
    current.push(last)
    if (i === 0) {
      inBook.push(true)
      return
    }
    stillBook = stillBook && isBookPosition(fen)
    inBook.push(stillBook)
    if (!stillBook && outOfBookPly === null && i > 1) outOfBookPly = i
  })
  return { current, inBook, outOfBookPly }
}

/**
 * Với vị trí trung gian chưa có tên: lấy khai cuộc có tên gần nhất đi qua vị trí này
 * (đi thêm tối đa 2 nước lý thuyết), để bảng "Nước tiếp theo" vẫn hiện được tên biến.
 */
function deepestNamed(fen: string, depth = 2): Opening {
  const o = openingAt(fen)
  if (o) return o
  if (depth > 0) {
    const pos = fromFen(fen)
    for (const move of legalMoves(pos)) {
      const p = pos.clone()
      p.play(move)
      const f = toFen(p)
      if (isBookPosition(f)) return deepestNamed(f, depth - 1)
    }
  }
  return { eco: '', name: 'Lý thuyết', pgn: '' }
}

export interface NextMove {
  uci: string
  san: string
  opening: Opening
}

/** Các nước đi tiếp từ `fen` mà vẫn nằm trong lý thuyết, kèm biến thể chúng dẫn tới. */
export function nextBookMoves(fen: string): NextMove[] {
  const pos = fromFen(fen)
  const out: NextMove[] = []
  for (const move of legalMoves(pos)) {
    const p = pos.clone()
    const san = makeSan(p, move)
    p.play(move)
    const after = toFen(p)
    if (!isBookPosition(after)) continue
    out.push({ uci: makeUci(move), san, opening: openingAt(after) ?? deepestNamed(after) })
  }
  return out.sort((a, b) => a.opening.name.localeCompare(b.opening.name))
}

/** Tên họ khai cuộc (trước dấu ":"), dùng để gộp thống kê. */
export function openingFamily(name: string): string {
  return name.split(':')[0]!.trim()
}
