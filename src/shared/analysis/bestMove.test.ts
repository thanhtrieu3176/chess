import { describe, expect, it } from 'vitest'
import type { MoveAnalysis, PositionEval } from '../types'
import { bestMoveInfo } from './bestMove'

const ma = (bestUci: string, threats: MoveAnalysis['motifs']['threats'] = []): MoveAnalysis => ({
  ply: 1,
  color: 'w',
  classification: 'blunder',
  winBefore: 90,
  winAfter: 40,
  accuracy: 10,
  bestUci,
  bestSan: null,
  phase: 'middlegame',
  motifs: { played: [], best: [], threats }
})
const ev = (pv: string[], cp = 500): PositionEval => ({ depth: 20, score: { cp }, lines: [{ multipv: 1, depth: 20, score: { cp }, pv }] })

describe('bestMoveInfo', () => {
  it('chiếu hết', () => {
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4'
    const r = bestMoveInfo(fen, 'h5f3', ma('h5f7'), ev(['h5f7'], 100000))!
    expect(r.san).toBe('Qxf7#')
    expect(r.isPlayed).toBe(false)
    expect(r.reasons[0]!.text).toContain('Chiếu hết')
  })

  it('nĩa trong biến chính, biến được định dạng', () => {
    const r = bestMoveInfo('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'e1d2', ma('b5c7'), ev(['b5c7', 'e8d7', 'c7a8']))!
    expect(r.line).toBe('1. Nc7+ Kd7 2. Nxa8')
    expect(r.reasons.map((x) => x.text).join(' ')).toContain('Nĩa')
  })

  it('cứu quân đang bị treo', () => {
    // Mã trắng d5 bị tốt đen c6 tấn công.
    const r = bestMoveInfo('4k3/8/2p5/3N4/8/8/8/4K3 w - - 0 1', 'e1e2', ma('d5f4'), ev(['d5f4']))!
    expect(r.reasons.some((x) => x.text.includes('bị treo'))).toBe(true)
  })

  it('đã đi đúng nước tốt nhất', () => {
    const r = bestMoveInfo('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4', ma('e2e4'), ev(['e2e4', 'e7e5'], 30))!
    expect(r.isPlayed).toBe(true)
    expect(r.reasons.some((x) => x.text.includes('trung tâm'))).toBe(true)
  })
})
