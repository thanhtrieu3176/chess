import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchChesscom, fetchChesscomRatings, fetchLichess } from './sites'
import { tbCategory } from './tablebase'

/** Giả lập fetch theo URL (không gọi mạng thật). */
function mockFetch(routes: Record<string, unknown>): void {
  vi.stubGlobal('fetch', async (url: string) => {
    const key = Object.keys(routes).find((k) => url.startsWith(k))
    if (!key) return new Response('not found', { status: 404 })
    const body = routes[key]
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 })
  })
}
afterEach(() => vi.unstubAllGlobals())

const game = (url: string, end: number, cls = 'blitz', white = 'thanhtrieu31760') => ({
  url,
  pgn: '[Event "x"]\n\n1. e4 *',
  time_class: cls,
  rules: 'chess',
  end_time: end,
  white: { username: white },
  black: { username: 'other' }
})

describe('Chess.com', () => {
  it('đọc archive mới nhất trước, lọc thể loại/màu, bỏ ván đã có, giới hạn số ván', async () => {
    mockFetch({
      'https://api.chess.com/pub/player/thanhtrieu31760/games/archives': {
        archives: ['https://api.chess.com/pub/player/thanhtrieu31760/games/2026/10', 'https://api.chess.com/pub/player/thanhtrieu31760/games/2026/11']
      },
      'https://api.chess.com/pub/player/thanhtrieu31760/games/2026/11': {
        games: [game('g3', 1762000000), game('g4', 1762100000, 'bullet'), game('g5', 1762200000, 'blitz', 'other')]
      },
      'https://api.chess.com/pub/player/thanhtrieu31760/games/2026/10': { games: [game('g1', 1760000000), game('g2', 1760100000)] }
    })
    const r = await fetchChesscom(
      { site: 'chesscom', username: 'ThanhTrieu31760', max: 2, speeds: ['blitz'], color: 'w' },
      (id) => id === 'g2',
      () => {}
    )
    expect(r.map((g) => g.sourceId)).toEqual(['g3', 'g1'])
  })

  it('rating theo thể loại', async () => {
    mockFetch({
      'https://api.chess.com/pub/player/me/stats': { chess_blitz: { last: { rating: 1200 }, best: { rating: 1300 } }, chess_rapid: { last: { rating: 1350 } } }
    })
    expect(await fetchChesscomRatings('me')).toEqual([
      { speed: 'blitz', rating: 1200, best: 1300 },
      { speed: 'rapid', rating: 1350, best: undefined }
    ])
  })
})

describe('Lichess', () => {
  it('đọc NDJSON, bỏ biến thể không chuẩn và ván đã có', async () => {
    const ndjson = [
      { id: 'aaaaaaaa', pgn: '1. e4 *', variant: 'standard' },
      { id: 'bbbbbbbb', pgn: '1. d4 *', variant: 'chess960' },
      { id: 'cccccccc', pgn: '1. c4 *', variant: 'standard' }
    ]
      .map((x) => JSON.stringify(x))
      .join('\n')
    mockFetch({ 'https://lichess.org/api/games/user/me': ndjson })
    const r = await fetchLichess({ site: 'lichess', username: 'me', max: 10 }, (id) => id === 'cccccccc', () => {})
    expect(r.map((g) => g.sourceId)).toEqual(['aaaaaaaa'])
  })
})

describe('Tablebase', () => {
  it('quy đổi category', () => {
    expect(tbCategory('cursed-win')).toBe('draw')
    expect(tbCategory('maybe-loss')).toBe('loss')
    expect(tbCategory('win')).toBe('win')
  })
})
