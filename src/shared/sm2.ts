/**
 * Lặp lại ngắt quãng, thuật toán SM-2 (SuperMemo 2) rút gọn.
 * quality: 5 = giải đúng ngay, 4 = đúng nhưng phải dùng gợi ý, 2 = sai, 0 = xem lời giải.
 * Làm sai (quality < 3) → quay lại sau 10 phút; làm đúng → khoảng cách tăng dần 1, 6, 6·ease... ngày.
 */
export interface Sm2State {
  ease: number
  intervalDays: number
  repetitions: number
  dueAt: number
}

const DAY = 86_400_000
export const RETRY_DELAY_MS = 10 * 60_000

export function sm2Review(s: Sm2State, quality: number, now = Date.now()): Sm2State {
  const q = Math.max(0, Math.min(5, quality))
  const ease = Math.max(1.3, s.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  if (q < 3) return { ease, intervalDays: 0, repetitions: 0, dueAt: now + RETRY_DELAY_MS }
  const repetitions = s.repetitions + 1
  const intervalDays = repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(s.intervalDays * ease)
  return { ease, intervalDays, repetitions, dueAt: now + intervalDays * DAY }
}

export function newSm2(now = Date.now()): Sm2State {
  return { ease: 2.5, intervalDays: 0, repetitions: 0, dueAt: now }
}
