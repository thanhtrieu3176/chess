import { createHash } from 'node:crypto'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type {
  GameAnalysis,
  GameDetail,
  GameFilter,
  GameRow,
  ImportResult,
  MoveAnalysis,
  PositionEval,
  Speed
} from '@shared/types'
import { parseGames, playedAtOf, speedOf, userColorOf, userResultOf, type ParsedGame } from '@shared/pgn'
import { openingsForGame } from '@shared/openings'
import { gameAccuracy } from '@shared/analysis/accuracy'
import { winPercent } from '@shared/analysis/winPercent'
import { transaction } from '../db'
import type { EvalCache } from '../EvalCache'

interface DbGame {
  id: number
  source: GameRow['source']
  source_id: string | null
  white: string
  black: string
  white_elo: number | null
  black_elo: number | null
  result: string
  termination: string | null
  played_at: number | null
  time_control: string | null
  speed: Speed | null
  eco: string | null
  opening_name: string | null
  user_color: 'w' | 'b' | null
  user_result: GameRow['userResult']
  pgn: string
  analysis_status: GameRow['analysisStatus']
  white_accuracy: number | null
  black_accuracy: number | null
}

export function toRow(g: DbGame): GameRow {
  return {
    id: g.id,
    source: g.source,
    sourceId: g.source_id,
    white: g.white,
    black: g.black,
    whiteElo: g.white_elo,
    blackElo: g.black_elo,
    result: g.result,
    termination: g.termination,
    playedAt: g.played_at,
    timeControl: g.time_control,
    speed: g.speed,
    eco: g.eco,
    openingName: g.opening_name,
    userColor: g.user_color,
    userResult: g.user_result,
    analysisStatus: g.analysis_status,
    whiteAccuracy: g.white_accuracy,
    blackAccuracy: g.black_accuracy
  }
}

/**
 * Xác định nguồn + ID để chống trùng: PGN dán tay nhưng có link Chess.com/Lichess vẫn được
 * nhận diện đúng nguồn (không bị nhập 2 lần khi sau đó tải tự động).
 */
function identify(g: ParsedGame, hint?: { source: GameRow['source']; sourceId: string }): { source: GameRow['source']; sourceId: string } {
  if (hint) return hint
  const link = g.headers.Link ?? g.headers.Site ?? ''
  if (/chess\.com\/game\//.test(link)) return { source: 'chesscom', sourceId: link }
  const li = /lichess\.org\/([A-Za-z0-9]{8})/.exec(link)
  if (li) return { source: 'lichess', sourceId: li[1]! }
  const key = [g.headers.White, g.headers.Black, g.headers.Date, g.startFen, g.moves.map((m) => m.uci).join(' ')].join('|')
  return { source: 'pgn', sourceId: createHash('sha1').update(key).digest('hex') }
}

/** Ghép PGN gốc thành từng ván để lưu (giữ nguyên chú thích, %clk). */
function splitPgn(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n(?=\[Event )/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export class GamesRepo {
  constructor(
    private readonly db: DatabaseSync,
    private readonly cache: EvalCache,
    private readonly usernames: () => string[]
  ) {}

  has(source: GameRow['source'], sourceId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM games WHERE source = ? AND source_id = ?').get(source, sourceId)
  }

  /** Nhập một hoặc nhiều ván từ văn bản PGN (dán tay / mở file). */
  importPgn(text: string): ImportResult {
    return this.importChunks(splitPgn(text))
  }

  /** Nhập các ván tải từ API (mỗi phần tử 1 ván, đã biết nguồn + ID). */
  importRaw(items: { pgn: string; source: GameRow['source']; sourceId: string }[]): ImportResult {
    return this.importChunks(
      items.map((i) => i.pgn),
      items.map((i) => ({ source: i.source, sourceId: i.sourceId }))
    )
  }

  private importChunks(chunks: string[], hints?: { source: GameRow['source']; sourceId: string }[]): ImportResult {
    const result: ImportResult = { added: 0, skipped: 0, errors: [], ids: [] }
    const insert = this.db.prepare(`
      INSERT INTO games (source, source_id, white, black, white_elo, black_elo, result, termination, played_at,
        time_control, speed, eco, opening_name, user_color, user_result, pgn, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_id) DO NOTHING`)
    const users = this.usernames()
    transaction(this.db, () => {
      chunks.forEach((chunk, ci) => {
        const { games, errors } = parseGames(chunk)
        result.errors.push(...errors)
        // Nếu tách theo [Event] không khớp số ván (PGN lạ) thì lưu lại từng ván ở dạng đã parse.
        games.forEach((g) => {
          const pgn = games.length === 1 ? chunk : rebuild(g)
          const id = identify(g, games.length === 1 ? hints?.[ci] : undefined)
          const h = g.headers
          const fens = [g.startFen, ...g.moves.map((m) => m.fenAfter)]
          const opening = openingsForGame(fens).current.findLast((o) => o !== null) ?? null
          const color = userColorOf(h, users)
          const r = insert.run(
            id.source,
            id.sourceId,
            h.White ?? '?',
            h.Black ?? '?',
            num(h.WhiteElo),
            num(h.BlackElo),
            h.Result ?? '*',
            h.Termination ?? null,
            playedAtOf(h),
            h.TimeControl ?? null,
            speedOf(h.TimeControl),
            opening?.eco ?? (/^[A-E]\d\d$/.test(h.ECO ?? '') ? h.ECO! : null),
            opening?.name ?? null,
            color,
            userResultOf(h.Result ?? '*', color),
            pgn,
            Date.now()
          )
          if (r.changes > 0) {
            result.added++
            result.ids.push(Number(r.lastInsertRowid))
          } else result.skipped++
        })
      })
    })
    return result
  }

  list(f: GameFilter): { rows: GameRow[]; total: number } {
    const where: string[] = []
    const args: SQLInputValue[] = []
    if (f.text) {
      where.push('(white LIKE ? OR black LIKE ?)')
      args.push(`%${f.text}%`, `%${f.text}%`)
    }
    if (f.result) {
      where.push('user_result = ?')
      args.push(f.result)
    }
    if (f.color) {
      where.push('user_color = ?')
      args.push(f.color)
    }
    if (f.speed) {
      where.push('speed = ?')
      args.push(f.speed)
    }
    if (f.opening) {
      where.push('(opening_name LIKE ? OR eco LIKE ?)')
      args.push(`%${f.opening}%`, `${f.opening}%`)
    }
    if (f.from) {
      where.push('played_at >= ?')
      args.push(f.from)
    }
    if (f.to) {
      where.push('played_at <= ?')
      args.push(f.to)
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const size = f.pageSize ?? 50
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM games ${w}`).get(...args) as { n: number }).n
    const rows = this.db
      .prepare(`SELECT * FROM games ${w} ORDER BY played_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...args, size, (f.page ?? 0) * size) as unknown as DbGame[]
    return { rows: rows.map(toRow), total }
  }

  row(id: number): (GameRow & { pgn: string }) | null {
    const g = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as DbGame | undefined
    return g ? { ...toRow(g), pgn: g.pgn } : null
  }

  /** Chi tiết ván: nước đi, khai cuộc từng nước, kết quả phân tích đã lưu (nếu có). */
  detail(id: number): Omit<GameDetail, 'repertoire'> | null {
    const row = this.row(id)
    if (!row) return null
    const parsed = parseGames(row.pgn).games[0]
    if (!parsed) return null
    const fens = [parsed.startFen, ...parsed.moves.map((m) => m.fenAfter)]
    const op = openingsForGame(fens)
    const { pgn: _pgn, ...gameRow } = row
    return {
      row: gameRow,
      headers: parsed.headers,
      startFen: parsed.startFen,
      moves: parsed.moves,
      openings: op.current,
      inBook: op.inBook,
      outOfBookPly: op.outOfBookPly,
      analysis: row.analysisStatus === 'none' ? null : this.loadAnalysis(id, fens)
    }
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM games WHERE id = ?').run(id)
  }

  private loadAnalysis(id: number, fens: string[]): GameAnalysis | null {
    const rows = this.db.prepare('SELECT * FROM moves WHERE game_id = ? ORDER BY ply').all(id) as unknown as {
      ply: number
      color: 'w' | 'b'
      win_before: number
      win_after: number
      accuracy: number
      classification: MoveAnalysis['classification']
      best_uci: string | null
      best_san: string | null
      phase: MoveAnalysis['phase']
      tactics: string | null
    }[]
    if (rows.length === 0) return null
    const positions: (PositionEval | null)[] = fens.map((fen) => {
      const r = this.cache.peek(fen)
      return r && r.lines[0] ? { depth: r.depth, lines: r.lines, score: r.lines[0].score } : null
    })
    const moves: (MoveAnalysis | null)[] = Array.from({ length: fens.length - 1 }, () => null)
    for (const r of rows) {
      moves[r.ply - 1] = {
        ply: r.ply,
        color: r.color,
        classification: r.classification,
        winBefore: r.win_before,
        winAfter: r.win_after,
        accuracy: r.accuracy,
        bestUci: r.best_uci,
        bestSan: r.best_san,
        phase: r.phase,
        motifs: r.tactics ? JSON.parse(r.tactics) : { played: [], best: [], threats: [] }
      }
    }
    // Vị trí kết thúc ván (chiếu hết...) không có trong cache: suy từ Win% đã lưu.
    positions.forEach((p, i) => {
      if (p || i === 0) return
      const m = moves[i - 1]
      if (m) {
        const whiteWin = m.color === 'w' ? m.winAfter : 100 - m.winAfter
        positions[i] = { depth: 0, lines: [], score: { cp: whiteWin >= 100 ? 100000 : whiteWin <= 0 ? -100000 : 0 } }
      }
    })
    const g = this.db.prepare('SELECT analysis_status, white_accuracy, black_accuracy FROM games WHERE id = ?').get(id) as {
      analysis_status: 'quick' | 'deep'
      white_accuracy: number | null
      black_accuracy: number | null
    }
    return {
      status: g.analysis_status,
      pass: g.analysis_status === 'deep' ? 2 : 1,
      done: fens.length,
      total: fens.length,
      positions,
      moves,
      accuracy: { w: g.white_accuracy, b: g.black_accuracy }
    }
  }

  saveAnalysis(gameId: number, fens: string[], moves: MoveAnalysis[], status: 'quick' | 'deep', accuracy: GameAnalysis['accuracy']): void {
    const parsed = parseGames(this.row(gameId)!.pgn).games[0]!
    const ins = this.db.prepare(`
      INSERT OR REPLACE INTO moves (game_id, ply, san, uci, fen_before, color, win_before, win_after, accuracy,
        classification, best_uci, best_san, phase, clock_ms, tactics, depth)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    transaction(this.db, () => {
      for (const m of moves) {
        const gm = parsed.moves[m.ply - 1]!
        ins.run(
          gameId,
          m.ply,
          gm.san,
          gm.uci,
          fens[m.ply - 1]!,
          m.color,
          m.winBefore,
          m.winAfter,
          m.accuracy,
          m.classification,
          m.bestUci,
          m.bestSan,
          m.phase,
          gm.clockMs ?? null,
          JSON.stringify(m.motifs),
          null
        )
      }
      this.db
        .prepare('UPDATE games SET analysis_status = ?, white_accuracy = ?, black_accuracy = ? WHERE id = ?')
        .run(status, accuracy.w, accuracy.b, gameId)
    })
  }

  /** Ván của tôi chưa phân tích (cho phân tích nền), mới nhất trước. */
  unanalyzedIds(limit: number): number[] {
    return (
      this.db
        .prepare("SELECT id FROM games WHERE analysis_status = 'none' AND user_color IS NOT NULL ORDER BY played_at DESC LIMIT ?")
        .all(limit) as { id: number }[]
    ).map((r) => r.id)
  }

  latestPlayedAt(source: GameRow['source']): number | null {
    const r = this.db.prepare('SELECT MAX(played_at) AS t FROM games WHERE source = ?').get(source) as { t: number | null }
    return r.t
  }

  /** Cập nhật lại bên của tôi khi đổi username trong Cài đặt. */
  refreshUserColors(): void {
    const users = this.usernames()
      .filter(Boolean)
      .map((u) => u.toLowerCase())
    const rows = this.db.prepare('SELECT id, white, black, result FROM games').all() as { id: number; white: string; black: string; result: string }[]
    const upd = this.db.prepare('UPDATE games SET user_color = ?, user_result = ? WHERE id = ?')
    transaction(this.db, () => {
      for (const r of rows) {
        const color = users.includes(r.white.toLowerCase()) ? 'w' : users.includes(r.black.toLowerCase()) ? 'b' : null
        upd.run(color, userResultOf(r.result, color), r.id)
      }
    })
  }
}

function num(s: string | undefined): number | null {
  const n = Number(s)
  return s && Number.isFinite(n) ? n : null
}

/** Dựng lại PGN tối giản (headers + nước đi) khi không tách được văn bản gốc. */
function rebuild(g: ParsedGame): string {
  const head = Object.entries(g.headers)
    .map(([k, v]) => `[${k} "${v}"]`)
    .join('\n')
  const body = g.moves.map((m) => (m.color === 'w' ? `${Math.ceil(m.ply / 2)}. ${m.san}` : m.san)).join(' ')
  return `${head}\n\n${body} ${g.headers.Result ?? '*'}`
}

/** Win% (góc nhìn Trắng) của mọi vị trí — dùng tính accuracy. */
export function accuracyOf(positions: PositionEval[], firstMover: 'w' | 'b'): GameAnalysis['accuracy'] {
  return gameAccuracy(
    positions.map((p) => winPercent(p.score)),
    firstMover
  )
}
