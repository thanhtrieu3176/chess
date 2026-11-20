/** Thống kê điểm yếu qua nhiều ván — chỉ tính NƯỚC ĐI CỦA TÔI và ván của tôi. */
import type { DatabaseSync } from 'node:sqlite'
import type { Classification, MoveMotifs, Phase, Speed, Stats } from '@shared/types'
import { openingFamily } from '@shared/openings'

/** Nhóm thời gian còn lại trên đồng hồ (giây) để phát hiện lỗi do áp lực thời gian. */
const CLOCK_BUCKETS: [string, number, number][] = [
  ['< 10 giây', 0, 10],
  ['10–30 giây', 10, 30],
  ['30–60 giây', 30, 60],
  ['1–3 phút', 60, 180],
  ['3–10 phút', 180, 600],
  ['> 10 phút', 600, Infinity]
]

export function computeStats(db: DatabaseSync): Stats {
  const games = db
    .prepare(
      `SELECT id, user_color, user_result, opening_name, played_at, speed, analysis_status,
        CASE user_color WHEN 'w' THEN white_accuracy ELSE black_accuracy END AS acc,
        CASE user_color WHEN 'w' THEN white_elo ELSE black_elo END AS elo
       FROM games WHERE user_color IS NOT NULL ORDER BY played_at`
    )
    .all() as {
    id: number
    user_color: 'w' | 'b'
    user_result: 'win' | 'draw' | 'loss' | null
    opening_name: string | null
    played_at: number | null
    speed: Speed | null
    analysis_status: string
    acc: number | null
    elo: number | null
  }[]

  const record = { win: 0, draw: 0, loss: 0 }
  const openings = new Map<string, Stats['openings'][number] & { accSum: number; accN: number }>()
  for (const g of games) {
    if (g.user_result) record[g.user_result]++
    const family = g.opening_name ? openingFamily(g.opening_name) : 'Không rõ'
    const key = `${g.user_color}|${family}`
    const o = openings.get(key) ?? { color: g.user_color, family, games: 0, win: 0, draw: 0, loss: 0, avgAccuracy: null, accSum: 0, accN: 0 }
    o.games++
    if (g.user_result) o[g.user_result]++
    if (g.acc !== null) {
      o.accSum += g.acc
      o.accN++
    }
    openings.set(key, o)
  }

  const userMoves = `FROM moves m JOIN games g ON g.id = m.game_id AND m.color = g.user_color`
  const analyzedGames = (db.prepare(`SELECT COUNT(DISTINCT m.game_id) AS n ${userMoves}`).get() as { n: number }).n

  const phaseRows = db
    .prepare(
      `SELECT m.phase AS phase, COUNT(*) AS moves, AVG(m.accuracy) AS acc, COUNT(DISTINCT m.game_id) AS games,
         SUM(m.classification IN ('mistake','miss','blunder')) AS errors, SUM(m.classification = 'blunder') AS blunders
       ${userMoves} GROUP BY m.phase`
    )
    .all() as { phase: Phase; moves: number; acc: number | null; games: number; errors: number; blunders: number }[]

  const clockRows = db
    .prepare(`SELECT m.clock_ms AS clock, m.classification AS c ${userMoves} WHERE m.clock_ms IS NOT NULL`)
    .all() as { clock: number; c: Classification }[]
  const clock = CLOCK_BUCKETS.map(([bucket, lo, hi]) => {
    const rows = clockRows.filter((r) => r.clock / 1000 >= lo && r.clock / 1000 < hi)
    return {
      bucket,
      moves: rows.length,
      blunders: rows.filter((r) => r.c === 'blunder').length,
      mistakes: rows.filter((r) => r.c === 'mistake' || r.c === 'miss').length
    }
  }).filter((b) => b.moves > 0)

  // Motif hay bỏ lỡ (có trong biến tốt nhất khi tôi đi sai) và hay dính (đối thủ có thể làm sau nước sai).
  const missed = new Map<string, number>()
  const suffered = new Map<string, number>()
  const errRows = db
    .prepare(`SELECT m.tactics AS t ${userMoves} WHERE m.classification IN ('inaccuracy','mistake','miss','blunder') AND m.tactics IS NOT NULL`)
    .all() as { t: string }[]
  for (const r of errRows) {
    const t = JSON.parse(r.t) as MoveMotifs
    for (const k of new Set(t.best.map((x) => x.kind))) missed.set(k, (missed.get(k) ?? 0) + 1)
    for (const k of new Set(t.threats.map((x) => x.kind))) suffered.set(k, (suffered.get(k) ?? 0) + 1)
  }
  const top = (m: Map<string, number>): { kind: string; count: number }[] =>
    [...m.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count)

  const classCounts: Partial<Record<Classification, number>> = {}
  for (const r of db.prepare(`SELECT m.classification AS c, COUNT(*) AS n ${userMoves} GROUP BY m.classification`).all() as {
    c: Classification
    n: number
  }[])
    classCounts[r.c] = r.n

  return {
    games: games.length,
    analyzed: analyzedGames,
    record,
    openings: [...openings.values()]
      .map(({ accSum, accN, ...o }) => ({ ...o, avgAccuracy: accN ? accSum / accN : null }))
      .sort((a, b) => b.loss - a.loss || b.games - a.games),
    phases: (['opening', 'middlegame', 'endgame'] as Phase[]).map((phase) => {
      const r = phaseRows.find((x) => x.phase === phase)
      return {
        phase,
        moves: r?.moves ?? 0,
        accuracy: r?.acc ?? null,
        errorsPerGame: r && analyzedGames ? r.errors / analyzedGames : 0,
        blundersPerGame: r && analyzedGames ? r.blunders / analyzedGames : 0
      }
    }),
    clock,
    motifsMissed: top(missed),
    motifsSuffered: top(suffered),
    accuracyTrend: games
      .filter((g) => g.acc !== null && g.played_at !== null)
      .map((g) => ({ gameId: g.id, playedAt: g.played_at!, accuracy: g.acc!, speed: g.speed })),
    ratingTrend: games
      .filter((g) => g.elo !== null && g.played_at !== null)
      .map((g) => ({ playedAt: g.played_at!, rating: g.elo!, speed: g.speed })),
    classCounts
  }
}
