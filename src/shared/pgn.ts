/** Đọc PGN (nhiều ván), thông tin đồng hồ %clk, và suy ra metadata (thể loại, bên của tôi...). */
import { parseComment, parsePgn, startingPosition } from 'chessops/pgn'
import { makeSanAndPlay, parseSan } from 'chessops/san'
import { makeUci } from 'chessops/util'
import { toFen } from './chess/position'

export interface GameMove {
  ply: number
  san: string
  uci: string
  fenBefore: string
  fenAfter: string
  color: 'w' | 'b'
  /** Thời gian còn lại trên đồng hồ của người vừa đi (ms), từ [%clk]. */
  clockMs?: number
}

export interface ParsedGame {
  headers: Record<string, string>
  startFen: string
  moves: GameMove[]
}

export type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily'

/** Đọc mọi ván trong một chuỗi PGN; ván lỗi được bỏ qua và báo lại. */
export function parseGames(text: string): { games: ParsedGame[]; errors: string[] } {
  const games: ParsedGame[] = []
  const errors: string[] = []
  for (const g of parsePgn(text)) {
    const headers = Object.fromEntries(g.headers)
    const label = `${headers.White ?? '?'} - ${headers.Black ?? '?'}`
    const start = startingPosition(g.headers)
    if (start.isErr) {
      errors.push(`${label}: FEN không hợp lệ`)
      continue
    }
    const pos = start.unwrap()
    const startFen = toFen(pos)
    const moves: GameMove[] = []
    let ok = true
    for (const node of g.moves.mainline()) {
      const move = parseSan(pos, node.san)
      if (!move) {
        errors.push(`${label}: nước không hợp lệ "${node.san}" ở nước ${moves.length + 1}`)
        ok = false
        break
      }
      const fenBefore = toFen(pos)
      const color = pos.turn === 'white' ? 'w' : 'b'
      const san = makeSanAndPlay(pos, move)
      const clock = (node.comments ?? []).map((c) => parseComment(c).clock).find((c) => c !== undefined)
      moves.push({
        ply: moves.length + 1,
        san,
        uci: makeUci(move),
        fenBefore,
        fenAfter: toFen(pos),
        color,
        clockMs: clock !== undefined ? Math.round(clock * 1000) : undefined
      })
    }
    if (ok || moves.length > 0) games.push({ headers, startFen, moves })
  }
  return { games, errors }
}

/**
 * Thể loại theo TimeControl "base+inc" (giây), theo cách Lichess: tổng = base + 40·inc.
 * < 3 phút bullet, < 8 phút blitz, < 25 phút rapid, còn lại classical. "1/86400" = daily.
 */
export function speedOf(timeControl: string | undefined): Speed | null {
  if (!timeControl || timeControl === '-' || timeControl === '?') return null
  if (timeControl.includes('/')) return 'daily'
  const [base, inc] = timeControl.split('+').map(Number)
  if (!Number.isFinite(base)) return null
  const total = base! + 40 * (inc ?? 0)
  if (total < 180) return 'bullet'
  if (total < 480) return 'blitz'
  if (total < 1500) return 'rapid'
  return 'classical'
}

/** Thời điểm ván đấu (ms) từ UTCDate/UTCTime hoặc Date. */
export function playedAtOf(h: Record<string, string>): number | null {
  const date = (h.UTCDate ?? h.Date ?? '').replaceAll('.', '-')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const time = /^\d{2}:\d{2}:\d{2}$/.test(h.UTCTime ?? '') ? h.UTCTime : '00:00:00'
  const t = Date.parse(`${date}T${time}Z`)
  return Number.isFinite(t) ? t : null
}

/** Xác định tôi cầm quân nào (so khớp username, không phân biệt hoa thường). */
export function userColorOf(h: Record<string, string>, usernames: string[]): 'w' | 'b' | null {
  const names = usernames.filter(Boolean).map((u) => u.toLowerCase())
  if (names.includes((h.White ?? '').toLowerCase())) return 'w'
  if (names.includes((h.Black ?? '').toLowerCase())) return 'b'
  return null
}

export function userResultOf(result: string, color: 'w' | 'b' | null): 'win' | 'draw' | 'loss' | null {
  if (!color) return null
  if (result === '1/2-1/2') return 'draw'
  if (result === '1-0') return color === 'w' ? 'win' : 'loss'
  if (result === '0-1') return color === 'b' ? 'win' : 'loss'
  return null
}
