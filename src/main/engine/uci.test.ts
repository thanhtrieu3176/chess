import { describe, expect, it } from 'vitest'
import { parseBestMove, parseInfo, toWhitePov } from './uci'

describe('parseInfo', () => {
  it('parse đầy đủ một dòng info MultiPV', () => {
    const line =
      'info depth 22 seldepth 31 multipv 2 score cp -35 nodes 1234567 nps 987654 hashfull 120 tbhits 0 time 1250 pv e7e5 g1f3 b8c6'
    expect(parseInfo(line)).toEqual({
      depth: 22,
      seldepth: 31,
      multipv: 2,
      score: { cp: -35 },
      nodes: 1234567,
      nps: 987654,
      time: 1250,
      pv: ['e7e5', 'g1f3', 'b8c6']
    })
  })

  it('parse điểm mate và bound', () => {
    const r = parseInfo('info depth 10 multipv 1 score mate -3 upperbound nodes 10 pv a1a2')
    expect(r?.score).toEqual({ mate: -3 })
    expect(r?.bound).toBe('upper')
  })

  it('bỏ qua trường wdl (3 giá trị)', () => {
    const r = parseInfo('info depth 5 multipv 1 score cp 20 wdl 100 800 100 nodes 50 pv d2d4')
    expect(r?.nodes).toBe(50)
    expect(r?.pv).toEqual(['d2d4'])
  })

  it('trả null cho info string / currmove', () => {
    expect(parseInfo('info string NNUE evaluation using nn.nnue')).toBeNull()
    expect(parseInfo('info currmove e2e4 currmovenumber 1')).toBeNull()
    expect(parseInfo('bestmove e2e4')).toBeNull()
  })
})

describe('parseBestMove', () => {
  it('parse nước tốt nhất', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ bestMove: 'e2e4' })
    expect(parseBestMove('bestmove (none)')).toEqual({ bestMove: null })
    expect(parseBestMove('info depth 1')).toBeNull()
  })
})

describe('toWhitePov', () => {
  it('đổi dấu khi đen đi', () => {
    expect(toWhitePov({ cp: 50 }, 'w')).toEqual({ cp: 50 })
    expect(toWhitePov({ cp: 50 }, 'b')).toEqual({ cp: -50 })
    expect(toWhitePov({ mate: 2 }, 'b')).toEqual({ mate: -2 })
  })

  it('mate 0 = bên đi đã bị chiếu hết', () => {
    expect(toWhitePov({ mate: 0 }, 'w')).toEqual({ cp: -100000 })
    expect(toWhitePov({ mate: 0 }, 'b')).toEqual({ cp: 100000 })
  })
})
