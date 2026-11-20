import { describe, expect, it } from 'vitest'
import { gameAccuracy, moveAccuracy } from './accuracy'
import { classify, type ClassifyInput } from './classify'
import { formatScore, winFor, winPercent } from './winPercent'
import { puzzleFrom } from './game'

describe('winPercent', () => {
  it('0cp = 50%, đối xứng, mate kẹp ở ±1000cp', () => {
    expect(winPercent({ cp: 0 })).toBe(50)
    expect(winPercent({ cp: 300 }) + winPercent({ cp: -300 })).toBeCloseTo(100)
    expect(winPercent({ cp: 100 })).toBeCloseTo(59.1, 1)
    expect(winPercent({ mate: 3 })).toBeCloseTo(winPercent({ cp: 1000 }))
    expect(winPercent({ mate: -1 })).toBeLessThan(3)
    expect(winFor({ cp: 100 }, 'b')).toBeCloseTo(40.9, 1)
  })

  it('định dạng điểm', () => {
    expect(formatScore({ cp: 125 })).toBe('+1.25')
    expect(formatScore({ cp: -40 })).toBe('-0.40')
    expect(formatScore({ mate: -2 })).toBe('#-2')
  })
})

describe('accuracy', () => {
  it('nước không mất Win% = 100, mất nhiều → thấp', () => {
    expect(moveAccuracy(50, 50)).toBe(100)
    expect(moveAccuracy(50, 60)).toBe(100)
    expect(moveAccuracy(60, 50)).toBeCloseTo(64.6, 0)
    expect(moveAccuracy(90, 10)).toBeLessThan(5)
  })

  it('ván không sai sót gần 100%, bên sai nhiều thấp hơn', () => {
    const perfect = gameAccuracy(Array.from({ length: 41 }, () => 50))
    expect(perfect.w).toBeCloseTo(100)
    expect(perfect.b).toBeCloseTo(100)
    // Đen blunder ở nước 10 (win trắng 50 → 90).
    const wins = Array.from({ length: 41 }, (_, i) => (i < 20 ? 50 : 90))
    const r = gameAccuracy(wins)
    expect(r.w).toBeCloseTo(100)
    expect(r.b!).toBeLessThan(80)
  })

  it('ván bắt đầu bằng nước của đen', () => {
    const r = gameAccuracy([50, 50, 20], 'b')
    expect(r.b).toBeCloseTo(100)
    expect(r.w!).toBeLessThan(100)
  })
})

const base: ClassifyInput = {
  winBefore: 50,
  winAfter: 50,
  playedUci: 'e2e4',
  bestUci: 'e2e4',
  isBook: false,
  sacrifice: false,
  isRecapture: false,
  forced: false
}

describe('classify', () => {
  it('ngưỡng theo Win% mất', () => {
    const c = (winAfter: number): string => classify({ ...base, bestUci: 'd2d4', winAfter })
    expect(c(49)).toBe('excellent')
    expect(c(46)).toBe('good')
    expect(c(43)).toBe('inaccuracy')
    expect(c(38)).toBe('mistake')
    expect(c(30)).toBe('blunder')
  })

  it('book ưu tiên cao nhất, best khi trùng engine', () => {
    expect(classify({ ...base, isBook: true, bestUci: 'd2d4', winAfter: 40 })).toBe('book')
    expect(classify(base)).toBe('best')
  })

  it('great: nước duy nhất, không tính ăn lại hay nước bắt buộc', () => {
    expect(classify({ ...base, secondBestWin: 30 })).toBe('great')
    expect(classify({ ...base, secondBestWin: 40 })).toBe('best')
    expect(classify({ ...base, secondBestWin: 30, isRecapture: true })).toBe('best')
    expect(classify({ ...base, secondBestWin: 30, forced: true })).toBe('best')
  })

  it('brilliant: thí quân, gần tốt nhất, chưa thắng tuyệt đối', () => {
    expect(classify({ ...base, sacrifice: true })).toBe('brilliant')
    expect(classify({ ...base, sacrifice: true, winBefore: 95, winAfter: 95 })).toBe('best')
    expect(classify({ ...base, sacrifice: true, bestUci: 'd2d4', winAfter: 47 })).toBe('good')
  })

  it('miss: bỏ lỡ cơ hội sau sai lầm của đối thủ', () => {
    const i = { ...base, bestUci: 'd2d4', winBefore: 85, winAfter: 60 }
    expect(classify({ ...i, prevOpponent: 'blunder' })).toBe('miss')
    expect(classify({ ...i, prevOpponent: 'best' })).toBe('blunder')
  })

  it('tablebase ghi đè engine', () => {
    expect(classify({ ...base, bestUci: 'd2d4', winAfter: 20, tablebase: { before: 'draw', after: 'draw' } })).toBe('excellent')
    expect(classify({ ...base, tablebase: { before: 'win', after: 'draw' } })).toBe('mistake')
    expect(classify({ ...base, tablebase: { before: 'win', after: 'loss' } })).toBe('blunder')
  })
})

describe('puzzleFrom', () => {
  const fen = 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1'
  const pe = (gapCp: number) => ({
    depth: 20,
    score: { cp: 500 },
    lines: [
      { multipv: 1, depth: 20, score: { cp: 500 }, pv: ['b5c7', 'e8d7', 'c7a8', 'd7c6'] },
      { multipv: 2, depth: 20, score: { cp: 500 - gapCp }, pv: ['e1d2', 'a8a2'] }
    ]
  })

  it('lời giải đi tiếp khi nước sau là ép buộc (ăn quân), gắn nhãn motif', () => {
    const p = puzzleFrom(fen, pe(500), 'w')!
    expect(p.solution).toEqual(['b5c7', 'e8d7', 'c7a8'])
    expect(p.motifs).toContain('fork')
  })

  it('không tạo puzzle khi nước tốt nhất không vượt trội nước thứ 2', () => {
    expect(puzzleFrom(fen, pe(20), 'w')).toBeNull()
  })
})
