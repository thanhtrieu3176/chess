import { describe, expect, it } from 'vitest'
import { newSm2, RETRY_DELAY_MS, sm2Review } from './sm2'

describe('SM-2', () => {
  it('đúng liên tiếp: 1 → 6 → ~15 ngày', () => {
    let s = newSm2(0)
    s = sm2Review(s, 5, 0)
    expect(s.intervalDays).toBe(1)
    s = sm2Review(s, 5, 0)
    expect(s.intervalDays).toBe(6)
    s = sm2Review(s, 5, 0)
    expect(s.intervalDays).toBe(Math.round(6 * s.ease))
    expect(s.ease).toBeCloseTo(2.8)
  })

  it('sai → quay lại sau 10 phút, giảm ease, reset chuỗi', () => {
    const s = sm2Review({ ease: 2.5, intervalDays: 6, repetitions: 2, dueAt: 0 }, 2, 1000)
    expect(s.repetitions).toBe(0)
    expect(s.dueAt).toBe(1000 + RETRY_DELAY_MS)
    expect(s.ease).toBeLessThan(2.5)
  })

  it('ease không xuống dưới 1.3', () => {
    let s = newSm2(0)
    for (let i = 0; i < 20; i++) s = sm2Review(s, 0, 0)
    expect(s.ease).toBe(1.3)
  })
})
