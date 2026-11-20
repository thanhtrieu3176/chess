import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from './db'
import { EvalCache } from './EvalCache'
import type { AnalysisResult } from '@shared/types'

const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

function result(depth: number, n: number): AnalysisResult {
  return {
    fen: FEN,
    depth,
    bestMove: 'e7e5',
    lines: Array.from({ length: n }, (_, i) => ({ multipv: i + 1, depth, score: { cp: 30 - i * 10 }, pv: ['e7e5'] }))
  }
}

function fresh(): { db: DatabaseSync; cache: EvalCache } {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  return { db, cache: new EvalCache(db) }
}

describe('EvalCache', () => {
  it('kết quả sâu dùng được cho yêu cầu nông hơn, không dùng cho yêu cầu sâu hơn', () => {
    const { cache } = fresh()
    cache.put(result(20, 3), 3)
    expect(cache.get(FEN, 14, 1)?.lines).toHaveLength(1)
    expect(cache.get(FEN, 20, 3)?.depth).toBe(20)
    expect(cache.get(FEN, 22, 1)).toBeNull()
  })

  it('bỏ qua halfmove/fullmove khi so khóa', () => {
    const { cache } = fresh()
    cache.put(result(12, 1), 1)
    expect(cache.get(FEN.replace(' 0 1', ' 7 30'), 1, 1)).not.toBeNull()
  })

  it('không ghi đè kết quả sâu bằng kết quả nông', () => {
    const { db, cache } = fresh()
    cache.put(result(20, 1), 1)
    cache.put(result(10, 3), 3)
    // Đọc lại từ SQLite bằng một cache mới (bỏ qua tầng RAM).
    const again = new EvalCache(db)
    expect(again.get(FEN, 1, 1)?.depth).toBe(20)
    expect(again.get(FEN, 1, 3)).toBeNull()
  })

  it('cùng độ sâu thì kết quả nhiều biến hơn thắng', () => {
    const { db, cache } = fresh()
    cache.put(result(15, 1), 1)
    cache.put(result(15, 3), 3)
    expect(new EvalCache(db).get(FEN, 15, 3)?.lines).toHaveLength(3)
  })
})

describe('migrate', () => {
  it('chạy lại nhiều lần không lỗi', () => {
    const { db } = fresh()
    migrate(db)
    const v = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(v.user_version).toBe(1)
  })
})
