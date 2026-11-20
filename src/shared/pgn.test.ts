import { describe, expect, it } from 'vitest'
import { parseGames, playedAtOf, speedOf, userColorOf, userResultOf } from './pgn'
import { MoveTree } from './tree'

const CHESSCOM = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.11.01"]
[White "thanhtrieu31760"]
[Black "opponent"]
[Result "0-1"]
[UTCDate "2026.11.01"]
[UTCTime "13:05:09"]
[TimeControl "600"]
[Link "https://www.chess.com/game/live/123"]

1. e4 {[%clk 0:09:58.1]} 1... e5 {[%clk 0:09:57]} 2. Qh5 {[%clk 0:09:50]} 2... Nc6 {[%clk 0:09:40]} 0-1

[Event "Second"]
[White "a"]
[Black "b"]
[Result "*"]

1. d4 d5 2. c4 *
`

describe('parseGames', () => {
  it('đọc nhiều ván, FEN từng nước, đồng hồ %clk', () => {
    const { games, errors } = parseGames(CHESSCOM)
    expect(errors).toEqual([])
    expect(games).toHaveLength(2)
    const g = games[0]!
    expect(g.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Qh5', 'Nc6'])
    expect(g.moves[0]!.uci).toBe('e2e4')
    expect(g.moves[1]!.color).toBe('b')
    expect(g.moves[0]!.clockMs).toBe(598100)
    expect(g.moves[3]!.fenBefore).toBe(g.moves[2]!.fenAfter)
  })

  it('báo lỗi nước không hợp lệ', () => {
    const { errors } = parseGames('[White "x"]\n\n1. e4 e5 2. Ke3 *')
    expect(errors[0]).toContain('Ke3')
  })
})

describe('metadata', () => {
  it('thể loại theo TimeControl', () => {
    expect(speedOf('60')).toBe('bullet')
    expect(speedOf('180+2')).toBe('blitz')
    expect(speedOf('600')).toBe('rapid')
    expect(speedOf('1800+30')).toBe('classical')
    expect(speedOf('1/86400')).toBe('daily')
    expect(speedOf('-')).toBeNull()
  })

  it('ngày giờ, bên của tôi, kết quả', () => {
    const h = parseGames(CHESSCOM).games[0]!.headers
    expect(playedAtOf(h)).toBe(Date.UTC(2026, 10, 1, 13, 5, 9))
    expect(userColorOf(h, ['ThanhTrieu31760'])).toBe('w')
    expect(userColorOf(h, ['someone'])).toBeNull()
    expect(userResultOf('0-1', 'w')).toBe('loss')
    expect(userResultOf('1/2-1/2', 'b')).toBe('draw')
  })
})

describe('MoveTree', () => {
  it('thêm biến phụ, nâng thành biến chính, xóa nhánh', () => {
    const t = MoveTree.fromPgn('1. e4 e5 2. Nf3 *')
    const e4 = t.root.children[0]!
    const c5 = t.addMove(e4, 'c7c5')!
    expect(t.isMainline(c5)).toBe(false)
    expect(t.addMove(e4, 'c7c5')).toBe(c5) // không tạo trùng
    t.promote(c5)
    expect(t.mainline().map((n) => n.san)).toEqual(['e4', 'c5'])
    t.delete(c5)
    expect(t.mainline().map((n) => n.san)).toEqual(['e4', 'e5', 'Nf3'])
  })

  it('xuất/nhập PGN có biến phụ và chú thích', () => {
    const t = MoveTree.fromPgn('1. e4 e5 (1... c5 {Sicilian} 2. Nf3) 2. Nf3 Nc6 *')
    const pgn = t.toPgn({ Result: '*' })
    expect(pgn).toContain('1. e4 e5 (1... c5 {Sicilian} 2. Nf3) 2. Nf3 Nc6 *')
    const again = MoveTree.fromPgn(pgn)
    expect(again.root.children[0]!.children.map((n) => n.san)).toEqual(['e5', 'c5'])
  })

  it('bắt đầu từ FEN tùy ý', () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 40'
    const t = new MoveTree(fen)
    t.addMove(t.root, 'e2e4')
    expect(t.toPgn()).toContain('[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 40"]')
    expect(t.toPgn()).toContain('40. e4')
  })
})
