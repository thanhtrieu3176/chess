import { describe, expect, it } from 'vitest'
import { fromFen, sq } from '../chess/position'
import { hangingPieces, seeCapture, seeMove } from '../chess/see'
import { lineMotifs, moveMotifsFen, positionMotifsFen, type MotifKind } from './index'

const kinds = (ms: { kind: MotifKind }[]): MotifKind[] => ms.map((m) => m.kind)

describe('SEE', () => {
  it('xe ăn tốt được tốt bảo vệ → lỗ 4', () => {
    const pos = fromFen('4k3/8/2p5/3p4/8/8/8/3RK3 w - - 0 1')
    expect(seeCapture(pos.board, sq('d5'), 'white')).toBe(-4)
  })

  it('ăn quân không được bảo vệ → lãi nguyên giá trị', () => {
    const pos = fromFen('4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1')
    expect(seeCapture(pos.board, sq('d5'), 'white')).toBe(3)
    expect(hangingPieces(pos.board, 'black').map((h) => h.loss)).toEqual([3])
  })

  it('tính tia X: xe đôi trên cùng cột', () => {
    // Trắng Rd1, Rd2 ăn d7 được 1 xe đen d8 bảo vệ: R×P, R×R, R×R → lãi 1.
    const pos = fromFen('3r2k1/3p4/8/8/8/8/3R4/3RK3 w - - 0 1')
    expect(seeCapture(pos.board, sq('d7'), 'white')).toBe(1)
    // Thêm vua đen e8 cũng bảo vệ d7 → trắng nên dừng sau R×P, R×R: lỗ 4.
    const withKing = fromFen('3rk3/3p4/8/8/8/8/3R4/3RK3 w - - 0 1')
    expect(seeCapture(withKing.board, sq('d7'), 'white')).toBe(-4)
  })

  it('Bxf7+ là thí tượng (−2)', () => {
    const pos = fromFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4')
    expect(seeMove(pos.board, { from: sq('c4'), to: sq('f7') })).toBe(-2)
  })
})

describe('motif của nước đi', () => {
  it('nĩa mã vào vua và xe', () => {
    const m = moveMotifsFen('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7')
    expect(kinds(m)).toContain('fork')
    expect(m.find((x) => x.kind === 'fork')?.squares).toEqual(['c7', 'a8', 'e8'])
  })

  it('xiên: tượng chiếu vua, ăn xe phía sau', () => {
    const m = moveMotifsFen('r7/8/2k5/5B2/8/8/8/4K3 w - - 0 1', 'f5e4')
    expect(kinds(m)).toContain('skewer')
  })

  it('chiếu mở', () => {
    const m = moveMotifsFen('4k3/8/8/8/4N3/8/8/K3R3 w - - 0 1', 'e4c5')
    expect(kinds(m)).toContain('discovered_check')
  })

  it('chiếu kép', () => {
    const m = moveMotifsFen('4k3/8/8/8/4N3/8/8/K3R3 w - - 0 1', 'e4f6')
    expect(kinds(m)).toContain('double_check')
  })

  it('thí quân', () => {
    const m = moveMotifsFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 'c4f7')
    expect(kinds(m)).toContain('sacrifice')
  })

  it('chiếu hết', () => {
    const m = moveMotifsFen('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 'h5f7')
    expect(kinds(m)).toEqual(['mate'])
  })

  it('nhập thành không làm hỏng bộ phát hiện (O-O và O-O-O)', () => {
    expect(() => moveMotifsFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1h1')).not.toThrow()
    expect(() => moveMotifsFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1a1')).not.toThrow()
    expect(kinds(moveMotifsFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1a1'))).not.toContain('sacrifice')
  })

  it('nước yên lặng không có motif', () => {
    expect(moveMotifsFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4')).toEqual([])
  })
})

describe('motif của vị trí', () => {
  it('ghim tuyệt đối', () => {
    const m = positionMotifsFen('4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1')
    const pin = m.find((x) => x.kind === 'pin')
    expect(pin?.side).toBe('b')
    expect(pin?.squares).toEqual(['e2', 'e7', 'e1'])
  })

  it('quân bị treo', () => {
    const m = positionMotifsFen('4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1')
    expect(m.filter((x) => x.kind === 'hanging').map((x) => x.squares[0])).toEqual(['d5'])
  })

  it('đe dọa chiếu hết (Qxf7#)', () => {
    const m = positionMotifsFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 3 3')
    const t = m.find((x) => x.kind === 'mate_threat')
    expect(t?.side).toBe('w')
    expect(t?.squares).toEqual(['f3', 'f7'])
  })

  it('yếu hàng cuối', () => {
    const m = positionMotifsFen('6k1/5ppp/8/8/8/8/8/4R1K1 b - - 0 1')
    expect(m.filter((x) => x.kind === 'back_rank').map((x) => x.side)).toEqual(['w'])
  })

  it('hậu phòng thủ quá tải', () => {
    const m = positionMotifsFen('7k/3q4/2n1b3/1B6/8/8/8/4R1K1 w - - 0 1')
    const o = m.find((x) => x.kind === 'overloaded')
    expect(o?.squares).toEqual(['d7', 'c6', 'e6'])
  })
})

describe('motif dọc theo biến', () => {
  it('tìm nĩa ở nước thứ 3 của PV', () => {
    // Trắng đi nước chờ, đen đi tốt, trắng nĩa ở nước thứ 3.
    const m = lineMotifs('r3k3/7p/8/1N6/8/8/8/4K3 w - - 0 1', ['e1d1', 'h7h6', 'b5c7'])
    expect(kinds(m)).toContain('fork')
  })
})
