/** Lichess Tablebase API (≤ 7 quân), có cache SQLite và xử lý mất mạng nhẹ nhàng. */
import type { DatabaseSync } from 'node:sqlite'
import type { TablebaseResult } from '@shared/types'
import { normalizeFen } from '@shared/fen'
import { fromFen } from '@shared/chess/position'
import { fetchJson } from './http'

interface TbResponse {
  category: string
  dtz: number | null
  dtm: number | null
  moves?: { uci: string; san: string }[]
}

/** Quy về thắng/hòa/thua thực tế (cursed-win/blessed-loss = hòa theo luật 50 nước). */
export function tbCategory(c: string): TablebaseResult['category'] {
  if (c === 'win' || c === 'maybe-win') return 'win'
  if (c === 'loss' || c === 'maybe-loss') return 'loss'
  if (c === 'draw' || c === 'cursed-win' || c === 'blessed-loss') return 'draw'
  return 'unknown'
}

const OFFLINE_BACKOFF_MS = 60_000

export class Tablebase {
  private offlineUntil = 0
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly db: DatabaseSync,
    private readonly log: (m: string) => void
  ) {}

  static eligible(fen: string): boolean {
    try {
      const pos = fromFen(fen)
      return pos.board.occupied.size() <= 7 && !pos.isEnd()
    } catch {
      return false
    }
  }

  /** Tra cứu; trả null khi không đủ điều kiện, mất mạng hoặc lỗi (không bao giờ ném lỗi). */
  lookup(fen: string): Promise<TablebaseResult | null> {
    if (!Tablebase.eligible(fen)) return Promise.resolve(null)
    const key = normalizeFen(fen)
    const row = this.db.prepare('SELECT response FROM tablebase_cache WHERE fen = ?').get(key) as { response: string } | undefined
    if (row) return Promise.resolve(JSON.parse(row.response) as TablebaseResult)
    if (Date.now() < this.offlineUntil) return Promise.resolve(null)
    // Tuần tự từng request để tôn trọng rate limit của Lichess.
    const job = this.chain.then(() => this.fetch(key))
    this.chain = job.catch(() => undefined)
    return job
  }

  private async fetch(key: string): Promise<TablebaseResult | null> {
    try {
      const r = await fetchJson<TbResponse>(`https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(key + ' 0 1')}`, {
        timeoutMs: 8000,
        retries: 1
      })
      const result: TablebaseResult = {
        category: tbCategory(r.category),
        dtz: r.dtz,
        dtm: r.dtm,
        bestUci: r.moves?.[0]?.uci ?? null,
        bestSan: r.moves?.[0]?.san ?? null
      }
      this.db
        .prepare('INSERT OR REPLACE INTO tablebase_cache (fen, response, fetched_at) VALUES (?, ?, ?)')
        .run(key, JSON.stringify(result), Date.now())
      return result
    } catch (e) {
      this.offlineUntil = Date.now() + OFFLINE_BACKOFF_MS
      this.log(`Tablebase không truy cập được: ${String(e)}`)
      return null
    }
  }
}
