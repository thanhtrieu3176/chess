/** Puzzle từ sai lầm của tôi + lặp lại ngắt quãng (SM-2). */
import type { DatabaseSync } from 'node:sqlite'
import type { Classification, Puzzle } from '@shared/types'
import { sm2Review } from '@shared/sm2'

interface Row {
  id: number
  game_id: number
  ply: number
  fen: string
  solution: string
  motifs: string
  source_class: Classification
  ease: number
  interval_days: number
  repetitions: number
  due_at: number
  last_result: string | null
  played_san: string | null
}

const SELECT = `SELECT p.*, m.san AS played_san FROM puzzles p LEFT JOIN moves m ON m.game_id = p.game_id AND m.ply = p.ply`

function toPuzzle(r: Row): Puzzle {
  return {
    id: r.id,
    gameId: r.game_id,
    ply: r.ply,
    fen: r.fen,
    solution: JSON.parse(r.solution) as string[],
    motifs: JSON.parse(r.motifs) as string[],
    sourceClass: r.source_class,
    dueAt: r.due_at,
    repetitions: r.repetitions,
    lastResult: r.last_result,
    playedSan: r.played_san
  }
}

export class PuzzleRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(id: number): Puzzle | null {
    const r = this.db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as Row | undefined
    return r ? toPuzzle(r) : null
  }

  /** Puzzle đến hạn sớm nhất (theo motif nếu có). */
  next(motif?: string, excludeId?: number): Puzzle | null {
    const rows = this.db.prepare(`${SELECT} ORDER BY p.due_at ASC`).all() as unknown as Row[]
    const r = rows.find((x) => x.id !== excludeId && (!motif || (JSON.parse(x.motifs) as string[]).includes(motif)))
    return r ? toPuzzle(r) : null
  }

  summary(): { total: number; due: number; motifs: { kind: string; count: number }[] } {
    const rows = this.db.prepare('SELECT motifs, due_at FROM puzzles').all() as { motifs: string; due_at: number }[]
    const counts = new Map<string, number>()
    for (const r of rows) for (const k of JSON.parse(r.motifs) as string[]) counts.set(k, (counts.get(k) ?? 0) + 1)
    return {
      total: rows.length,
      due: rows.filter((r) => r.due_at <= Date.now()).length,
      motifs: [...counts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count)
    }
  }

  /** Chấm điểm sau khi giải: 5 = đúng ngay, 4 = đúng nhờ gợi ý, 2 = sai, 0 = xem lời giải. */
  grade(id: number, quality: number): Puzzle | null {
    const r = this.db.prepare('SELECT ease, interval_days, repetitions, due_at FROM puzzles WHERE id = ?').get(id) as
      | { ease: number; interval_days: number; repetitions: number; due_at: number }
      | undefined
    if (!r) return null
    const s = sm2Review({ ease: r.ease, intervalDays: r.interval_days, repetitions: r.repetitions, dueAt: r.due_at }, quality)
    this.db
      .prepare('UPDATE puzzles SET ease = ?, interval_days = ?, repetitions = ?, due_at = ?, last_result = ? WHERE id = ?')
      .run(s.ease, s.intervalDays, s.repetitions, s.dueAt, quality >= 3 ? 'pass' : 'fail', id)
    return this.get(id)
  }
}
