import { describe, expect, it } from 'vitest'
import { START_FEN } from '../fen'
import { playSan } from '../chess/position'
import { nextBookMoves, openingAt, openingFamily, openingsForGame } from './index'

function fensOf(sans: string[]): string[] {
  const fens = [START_FEN]
  for (const s of sans) fens.push(playSan(fens[fens.length - 1]!, s)!.fen)
  return fens
}

describe('openings', () => {
  it('nhận diện theo từng nước: Sicilian → Najdorf', () => {
    const fens = fensOf(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'])
    const r = openingsForGame(fens)
    expect(r.current[2]?.name).toBe('Sicilian Defense')
    expect(r.current[10]?.name).toBe('Sicilian Defense: Najdorf Variation')
    expect(r.current[10]?.eco).toBe('B90')
    expect(r.inBook.every(Boolean)).toBe(true)
    expect(r.outOfBookPly).toBeNull()
  })

  it('khớp transposition (thứ tự nước khác)', () => {
    const a = fensOf(['d4', 'Nf6', 'c4', 'e6'])
    const b = fensOf(['c4', 'e6', 'd4', 'Nf6'])
    expect(openingAt(a[4]!)?.name).toBe(openingAt(b[4]!)?.name)
  })

  it('đánh dấu nước ra khỏi sách, giữ tên khai cuộc gần nhất', () => {
    const r = openingsForGame(fensOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'Qe2', 'h5', 'h3', 'Rh6']))
    expect(r.outOfBookPly).not.toBeNull()
    expect(r.inBook[r.outOfBookPly!]).toBe(false)
    expect(r.current[12]?.name).toContain('Ruy Lopez')
  })

  it('bảng nước tiếp theo', () => {
    const fen = fensOf(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'])[9]!
    const next = nextBookMoves(fen)
    const byS = Object.fromEntries(next.map((n) => [n.san, n.opening.name]))
    expect(byS['a6']).toBe('Sicilian Defense: Najdorf Variation')
    expect(byS['g6']).toContain('Dragon')
  })

  it('họ khai cuộc', () => {
    expect(openingFamily('Sicilian Defense: Najdorf Variation')).toBe('Sicilian Defense')
  })
})
