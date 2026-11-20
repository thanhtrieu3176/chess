import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { CancelledError, defaultEngineConfig, EnginePool } from './EnginePool'
import { EngineProcess } from './EngineProcess'

/** Test tích hợp với Stockfish thật: đặt STOCKFISH_PATH hoặc cài stockfish vào PATH mặc định. */
const SF = process.env.STOCKFISH_PATH ?? ['/usr/games/stockfish', '/usr/bin/stockfish'].find((p) => existsSync(p))
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
// Trắng đi: Qh5xf7# (scholar's mate) có sẵn.
const MATE_IN_1 = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4'
// Đen đi, đen đang bị chiếu hết.
const MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'

describe('defaultEngineConfig', () => {
  it('chia CPU hợp lý', () => {
    expect(defaultEngineConfig(1)).toEqual({ poolSize: 1, poolThreads: 1, liveThreads: 1 })
    expect(defaultEngineConfig(4)).toEqual({ poolSize: 3, poolThreads: 1, liveThreads: 3 })
    expect(defaultEngineConfig(8)).toEqual({ poolSize: 4, poolThreads: 1, liveThreads: 7 })
    expect(defaultEngineConfig(16)).toEqual({ poolSize: 4, poolThreads: 3, liveThreads: 15 })
  })
})

describe.skipIf(!SF)('EnginePool (Stockfish thật)', () => {
  let pool: EnginePool | null = null
  afterEach(async () => {
    await pool?.shutdown()
    pool = null
  })
  const start = async (poolSize = 2) => {
    pool = new EnginePool()
    await pool.start({ path: SF!, poolSize, poolThreads: 1, liveThreads: 1, hashMb: 16 })
    return pool
  }

  it('phân tích có giới hạn, điểm theo góc nhìn trắng, MultiPV', async () => {
    const p = await start()
    const r = await p.analyze(MATE_IN_1, { depth: 8 }, 2, 'game')
    expect(r.bestMove).toBe('h5f7')
    expect(r.lines).toHaveLength(2)
    expect(r.lines[0]!.score).toEqual({ mate: 1 })
  })

  it('vị trí đã bị chiếu hết: không có nước', async () => {
    const p = await start(1)
    const r = await p.analyze(MATED, { depth: 5 }, 1, 'game')
    expect(r.bestMove).toBeNull()
  })

  it('chạy song song nhiều job và giữ thứ tự ưu tiên', async () => {
    const p = await start(1)
    const order: string[] = []
    const jobs = [
      p.analyze(START, { movetime: 100 }, 1, 'background').then(() => order.push('bg1')),
      p.analyze(START, { movetime: 50 }, 1, 'background').then(() => order.push('bg2')),
      p.analyze(START, { movetime: 50 }, 1, 'game').then(() => order.push('game'))
    ]
    await Promise.all(jobs)
    // bg1 chạy ngay (engine rảnh); trong hàng đợi, 'game' được ưu tiên hơn bg2.
    expect(order).toEqual(['bg1', 'game', 'bg2'])
  })

  it('hủy job trong hàng đợi', async () => {
    const p = await start(1)
    const first = p.analyze(START, { movetime: 200 }, 1, 'background')
    const second = p.analyze(START, { movetime: 200 }, 1, 'background')
    p.cancel('background')
    await expect(second).rejects.toBeInstanceOf(CancelledError)
    await expect(first).rejects.toBeInstanceOf(CancelledError)
    // Pool vẫn dùng được sau khi hủy.
    const r = await p.analyze(START, { depth: 5 }, 1, 'game')
    expect(r.bestMove).toBeTruthy()
  })

  it('phân tích vô hạn stream info và dừng được', async () => {
    const p = await start(1)
    const updates: number[] = []
    let done = false
    await p.startLive(START, 2, (r, d) => {
      updates.push(r.depth)
      if (d) done = true
    })
    await new Promise((r) => setTimeout(r, 400))
    await p.stopLive()
    await new Promise((r) => setTimeout(r, 50))
    expect(updates.length).toBeGreaterThan(3)
    expect(done).toBe(true)
  })

  it('watchdog: engine bị kill giữa chừng → tự khởi động lại và chạy lại job', async () => {
    const p = await start(1)
    const job = p.analyze(START, { movetime: 1500 }, 1, 'game')
    await new Promise((r) => setTimeout(r, 200))
    // Giết tiến trình Stockfish đang chạy job (giả lập crash).
    const engines = (p as unknown as { batch: EngineProcess[] }).batch
    ;(engines[0] as unknown as { proc: { kill: (s: string) => void } }).proc.kill('SIGKILL')
    const r = await job
    expect(r.bestMove).toBeTruthy()
  })

  it('shutdown không để lại process', async () => {
    const p = await start(2)
    const procs = [
      ...(p as unknown as { batch: EngineProcess[] }).batch,
      (p as unknown as { live: EngineProcess }).live
    ].map((e) => (e as unknown as { proc: { pid: number } }).proc.pid)
    await p.shutdown()
    pool = null
    for (const pid of procs) {
      expect(() => process.kill(pid, 0)).toThrow()
    }
  })
})
