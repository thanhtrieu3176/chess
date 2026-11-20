import { describe, expect, it } from 'vitest'
import { extractSans, findUnknownMoves } from './verify'
import { parsePartialJson } from '@shared/partialJson'
import { RateLimiter } from './rateLimiter'

describe('hậu kiểm nước đi trong câu trả lời Gemini', () => {
  it('trích nước SAN, bỏ qua tên ô thường', () => {
    expect(extractSans('Nước Nf3 rất tốt, sau đó Bxe5+ và O-O. Ô e4 yếu; exd5 mở cột; e8=Q thắng.')).toEqual([
      'Nf3',
      'Bxe5',
      'O-O',
      'exd5',
      'e8=Q'
    ])
  })

  it('báo nước không có trong dữ liệu', () => {
    const data = { tom_tat: 'Bạn nên đi Nf3 thay vì Qh5', y: ['Đối thủ có Bb4+ rất mạnh'] }
    expect(findUnknownMoves(data, new Set(['Nf3', 'Qh5']))).toEqual(['Bb4'])
    expect(findUnknownMoves(data, new Set(['Nf3', 'Qh5', 'Bb4+']))).toEqual([])
  })
})

describe('JSON stream dở', () => {
  it('đóng tạm chuỗi và ngoặc', () => {
    expect(parsePartialJson('{"tom_tat": "Nước đi tố')).toEqual({ tom_tat: 'Nước đi tố' })
    expect(parsePartialJson('{"a": ["x", "y')).toEqual({ a: ['x', 'y'] })
    expect(parsePartialJson('{"a": 1, ')).toEqual({ a: 1 })
  })
})

describe('RateLimiter', () => {
  it('chạy tuần tự', async () => {
    const rl = new RateLimiter(() => 100)
    const order: number[] = []
    await Promise.all([1, 2, 3].map((i) => rl.schedule(async () => order.push(i))))
    expect(order).toEqual([1, 2, 3])
  })
})
