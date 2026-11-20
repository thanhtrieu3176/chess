/** Lấy ván đấu theo username từ Chess.com Public API và Lichess API. */
import type { FetchOptions, Speed } from '@shared/types'
import { fetchJson, fetchRetry, NetError } from './http'

export interface RawGame {
  source: 'chesscom' | 'lichess'
  sourceId: string
  pgn: string
}

interface ChesscomGame {
  url: string
  pgn?: string
  time_class: string
  rules: string
  end_time: number
  white: { username: string }
  black: { username: string }
}

/** Danh sách archive theo tháng, dạng ".../games/2026/11". */
function monthOf(archiveUrl: string): number {
  const m = /\/(\d{4})\/(\d{2})$/.exec(archiveUrl)
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) : 0
}

export async function fetchChesscom(
  opts: FetchOptions,
  known: (sourceId: string) => boolean,
  onProgress: (msg: string) => void
): Promise<RawGame[]> {
  const user = encodeURIComponent(opts.username.trim().toLowerCase())
  const { archives } = await fetchJson<{ archives: string[] }>(`https://api.chess.com/pub/player/${user}/games/archives`)
  const out: RawGame[] = []
  // Mới nhất trước; bỏ các tháng nằm ngoài khoảng thời gian.
  const months = archives
    .filter((a) => {
      const start = monthOf(a)
      const end = new Date(start)
      end.setUTCMonth(end.getUTCMonth() + 1)
      return (!opts.since || end.getTime() > opts.since) && (!opts.until || start <= opts.until)
    })
    .reverse()
  for (const url of months) {
    if (out.length >= opts.max) break
    onProgress(`Chess.com: đang đọc tháng ${url.slice(-7)} (${out.length}/${opts.max} ván)`)
    const { games } = await fetchJson<{ games: ChesscomGame[] }>(url)
    for (const g of games.sort((a, b) => b.end_time - a.end_time)) {
      if (out.length >= opts.max) break
      if (g.rules !== 'chess' || !g.pgn) continue
      const t = g.end_time * 1000
      if ((opts.since && t < opts.since) || (opts.until && t > opts.until)) continue
      if (opts.speeds?.length && !opts.speeds.includes(g.time_class as Speed)) continue
      if (opts.color) {
        const me = opts.username.toLowerCase()
        const color = g.white.username.toLowerCase() === me ? 'w' : 'b'
        if (color !== opts.color) continue
      }
      if (known(g.url)) continue
      out.push({ source: 'chesscom', sourceId: g.url, pgn: g.pgn })
    }
  }
  return out
}

export async function fetchLichess(
  opts: FetchOptions,
  known: (sourceId: string) => boolean,
  onProgress: (msg: string) => void
): Promise<RawGame[]> {
  const params = new URLSearchParams({
    max: String(Math.min(opts.max * 2, 300)), // xin dư một chút để bù các ván đã có
    clocks: 'true',
    opening: 'true',
    pgnInJson: 'true'
  })
  if (opts.since) params.set('since', String(opts.since))
  if (opts.until) params.set('until', String(opts.until))
  if (opts.speeds?.length) params.set('perfType', opts.speeds.join(','))
  if (opts.color) params.set('color', opts.color === 'w' ? 'white' : 'black')
  onProgress('Lichess: đang tải...')
  const res = await fetchRetry(`https://lichess.org/api/games/user/${encodeURIComponent(opts.username.trim())}?${params}`, {
    headers: { Accept: 'application/x-ndjson' },
    timeoutMs: 60_000
  })
  if (!res.ok) throw new NetError(`Lichess trả lỗi HTTP ${res.status}`, res.status)
  const out: RawGame[] = []
  for (const line of (await res.text()).split('\n')) {
    if (!line.trim() || out.length >= opts.max) continue
    const g = JSON.parse(line) as { id: string; pgn?: string; variant?: string }
    if (!g.pgn || (g.variant && g.variant !== 'standard') || known(g.id)) continue
    out.push({ source: 'lichess', sourceId: g.id, pgn: g.pgn })
  }
  return out
}

export async function fetchChesscomRatings(username: string): Promise<{ speed: string; rating: number; best?: number }[]> {
  const stats = await fetchJson<Record<string, { last?: { rating: number }; best?: { rating: number } }>>(
    `https://api.chess.com/pub/player/${encodeURIComponent(username.trim().toLowerCase())}/stats`
  )
  const map: Record<string, string> = { chess_bullet: 'bullet', chess_blitz: 'blitz', chess_rapid: 'rapid', chess_daily: 'daily' }
  return Object.entries(map)
    .filter(([k]) => stats[k]?.last)
    .map(([k, speed]) => ({ speed, rating: stats[k]!.last!.rating, best: stats[k]!.best?.rating }))
}
