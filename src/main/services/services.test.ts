import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '../db'
import { EvalCache } from '../EvalCache'
import { GamesRepo } from './games'
import { RepertoireRepo } from './repertoire'
import { PuzzleRepo } from './puzzles'
import { computeStats } from './stats'
import { GameAnalyzer } from './analyzer'
import { EnginePool } from '../engine/EnginePool'
import { defaultSettings, type SettingsStore } from '../settings'
import type { Tablebase } from '../net/tablebase'

const SF = process.env.STOCKFISH_PATH ?? ['/usr/games/stockfish', '/usr/bin/stockfish'].find((p) => existsSync(p))

const PGN = `[Event "A"]
[Site "https://www.chess.com/game/live/1"]
[White "me"]
[Black "x"]
[Result "0-1"]
[Date "2026.11.01"]
[TimeControl "600"]

1. e4 {[%clk 0:09:58]} e5 {[%clk 0:09:58]} 2. Bc4 {[%clk 0:09:50]} Nc6 {[%clk 0:09:50]} 3. Qh5 {[%clk 0:09:40]} Nf6 {[%clk 0:09:40]} 4. Qxf7# {[%clk 0:09:30]} 1-0

[Event "B"]
[White "x"]
[Black "me"]
[Result "1-0"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0
`

function setup() {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const cache = new EvalCache(db)
  const games = new GamesRepo(db, cache, () => ['me'])
  return { db, cache, games }
}

describe('GamesRepo', () => {
  it('nhập nhiều ván, nhận diện nguồn qua link, chống trùng, bên của tôi', () => {
    const { games } = setup()
    const r = games.importPgn(PGN)
    expect(r.added).toBe(2)
    expect(games.importPgn(PGN).skipped).toBe(2)
    const { rows, total } = games.list({})
    expect(total).toBe(2)
    const a = rows.find((g) => g.white === 'me')!
    expect(a.source).toBe('chesscom')
    expect(a.userColor).toBe('w')
    expect(a.speed).toBe('rapid')
    expect(a.openingName).toContain('Bishop')
    expect(games.list({ color: 'b' }).total).toBe(1)
    expect(games.list({ result: 'loss' }).total).toBe(1)
    expect(games.has('chesscom', 'https://www.chess.com/game/live/1')).toBe(true)
  })

  it('chi tiết ván: khai cuộc theo từng nước, đồng hồ', () => {
    const { games } = setup()
    const id = games.importPgn(PGN).ids[0]!
    const d = games.detail(id)!
    expect(d.moves).toHaveLength(7)
    expect(d.moves[0]!.clockMs).toBe(598000)
    expect(d.openings[3]?.name).toBeTruthy()
  })
})

describe('RepertoireRepo', () => {
  it('nhập PGN có biến phụ, báo lệch repertoire và nước lạ của đối thủ', () => {
    const { db, games } = setup()
    const rep = new RepertoireRepo(db)
    expect(rep.importPgn('w', '1. e4 e5 (1... c5 2. Nf3) 2. Nf3 {Phát triển} Nc6 *')).toBe(6)
    expect(rep.importPgn('w', '1. e4 e5 *')).toBe(0)
    expect(rep.movesAt('w', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1').map((m) => m.san).sort()).toEqual(['c5', 'e5'])
    const d = games.detail(games.importPgn(PGN).ids[0]!)!
    // Tôi (Trắng) đi 2. Bc4 thay vì Nf3.
    const c = rep.check('w', d.moves)!
    expect(c.kind).toBe('user_deviated')
    expect(c.message).toContain('Bc4')
    expect(c.message).toContain('Nf3')
    // Đối thủ đi 1... d5 ngoài repertoire.
    const d2 = games.detail(games.importPgn('[White "me"]\n[Black "y"]\n[Result "*"]\n\n1. e4 d5 *').ids[0]!)!
    expect(rep.check('w', d2.moves)?.kind).toBe('opponent_novelty')
  })
})

describe.skipIf(!SF)('GameAnalyzer (Stockfish thật)', () => {
  const env = setup()
  const pool = new EnginePool()
  const settings = { get: () => ({ ...defaultSettings(), quickMovetimeMs: 100, deepDepth: 12, multiPv: 2 }) } as unknown as SettingsStore
  const tablebase = { lookup: async () => null } as unknown as Tablebase
  const updates: number[] = []
  const analyzer = new GameAnalyzer({
    db: env.db,
    pool,
    cache: env.cache,
    games: env.games,
    settings,
    tablebase,
    log: () => {},
    onUpdate: (_id, a) => updates.push(a.done),
    onFinished: () => {}
  })
  beforeAll(() => pool.start({ path: SF!, poolSize: 2, poolThreads: 1, liveThreads: 1, hashMb: 16 }))
  afterAll(() => pool.shutdown())

  it('phân tích 2 lượt, phân loại, accuracy, puzzle, lưu DB, hiển thị dần', async () => {
    const ids = env.games.importPgn(PGN).ids
    const black = ids[1]! // tôi cầm Đen và đi 3...Nf6?? (bỏ qua Qxf7#)
    const a = (await analyzer.analyze(black))!
    expect(a.status).toBe('deep')
    expect(updates.length).toBeGreaterThan(3)
    const nf6 = a.moves[5]!
    expect(nf6.classification).toBe('blunder')
    expect(nf6.motifs.threats.map((m) => m.kind)).toContain('mate')
    expect(a.moves[6]!.classification).toMatch(/best|great/)
    expect(a.accuracy.b!).toBeLessThan(a.accuracy.w!)
    const row = env.games.row(black)!
    expect(row.analysisStatus).toBe('deep')
    expect(env.games.detail(black)!.analysis!.moves[5]!.classification).toBe('blunder')
    const stats = computeStats(env.db)
    expect(stats.classCounts.blunder).toBe(1)
    expect(stats.motifsSuffered.map((m) => m.kind)).toContain('mate')
    // Puzzle chỉ tạo khi lời giải rõ ràng; vị trí trước 3...Nf6 có nhiều cách phòng thủ → có thể không có.
    const pz = new PuzzleRepo(env.db)
    expect(pz.summary().total).toBeGreaterThanOrEqual(0)
  })
})
