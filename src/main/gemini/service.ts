import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { GoogleGenAI } from '@google/genai'
import type { ExplainRequest, ExplainResult, GameDetail, Stats } from '@shared/types'
import { KEY_MOMENTS } from '@shared/analysis/classify'
import type { SettingsStore } from '../settings'
import { RateLimiter } from './rateLimiter'
import { findUnknownMoves } from './verify'
import { gameData, moveData, openingData, overviewData, puzzleData, type PromptData } from './context'
import { GAME, MOMENTS, MOVE, OPENING, OVERVIEW, PUZZLE, systemInstruction, type PromptTemplate } from './prompts'

const TIMEOUT_MS = 60_000
const MAX_429_RETRIES = 3
const BATCH_SIZE = 6

export class QuotaError extends Error {}

export interface GeminiContext {
  gameDetail: (id: number) => GameDetail | null
  stats: () => Stats
  puzzle: (id: number) => { fen: string; solution: string[]; motifs: string[]; playedSan: string | null; sourceClass: string } | null
}

type OnChunk = (text: string) => void

/**
 * Gọi Gemini (chỉ ở main process; key không bao giờ xuống renderer):
 * cache SQLite → hàng đợi giới hạn tốc độ → stream → hậu kiểm nước đi (gọi lại 1 lần nếu "bịa").
 */
export class GeminiService {
  private limiter: RateLimiter
  private prefetching = new Set<number>()

  constructor(
    private readonly db: DatabaseSync,
    private readonly settings: SettingsStore,
    private readonly ctx: GeminiContext,
    private readonly log: (m: string) => void
  ) {
    this.limiter = new RateLimiter(() => settings.get().geminiRpm)
  }

  async explain(req: ExplainRequest, onChunk?: OnChunk, opts: { cacheOnly?: boolean } = {}): Promise<ExplainResult> {
    try {
      const name = this.settings.get().displayName
      const { tpl, data, key } = this.build(req, name)
      const cached = this.readCache(key)
      if (cached) return { ...cached, ok: true, cached: true }
      if (opts.cacheOnly) return { ok: false, error: 'not_cached' }
      const r = await this.generate(tpl, data, name, onChunk)
      this.writeCache(key, tpl, r, 'gameId' in req ? req.gameId : null)
      return { ok: true, ...r }
    } catch (e) {
      return { ok: false, error: friendly(e) }
    }
  }

  /**
   * Tải trước lời giải thích cho các khoảnh khắc quan trọng của ván (chạy nền sau khi phân tích),
   * gộp nhiều khoảnh khắc vào 1 request nếu bật tùy chọn gộp.
   */
  async prefetchGame(gameId: number): Promise<void> {
    const s = this.settings.get()
    if (!s.geminiAutoExplain || !this.settings.getGeminiKey() || this.prefetching.has(gameId)) return
    const detail = this.ctx.gameDetail(gameId)
    if (!detail?.analysis) return
    this.prefetching.add(gameId)
    try {
      const pending = detail.analysis.moves
        .filter((m) => m && KEY_MOMENTS.includes(m.classification))
        .map((m) => m!.ply)
        .filter((ply) => !this.readCache(this.build({ kind: 'move', gameId, ply }, s.displayName).key))
      if (pending.length === 0) return
      if (!s.geminiBatch) {
        for (const ply of pending) {
          const r = await this.explain({ kind: 'move', gameId, ply })
          if (!r.ok && r.error?.includes('quota')) break
        }
        return
      }
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        await this.explainBatch(detail, pending.slice(i, i + BATCH_SIZE), s.displayName)
      }
    } catch (e) {
      this.log(`Prefetch Gemini ván ${gameId} lỗi: ${friendly(e)}`)
    } finally {
      this.prefetching.delete(gameId)
    }
  }

  private async explainBatch(detail: GameDetail, plies: number[], name: string): Promise<void> {
    const parts = plies.map((ply) => ({ ply, d: moveData(detail, ply, name) }))
    const allowed = new Set(parts.flatMap((p) => [...p.d.allowed]))
    const text = parts.map((p) => `### Khoảnh khắc ply ${p.ply}\n${p.d.text}`).join('\n\n')
    const r = await this.generate(MOMENTS, { text, allowed }, name)
    const items = ((r.data as { giai_thich?: ({ ply: number } & Record<string, unknown>)[] }).giai_thich ?? [])
    for (const item of items) {
      if (!plies.includes(item.ply)) continue
      const { ply, ...data } = item
      const { key } = this.build({ kind: 'move', gameId: detail.row.id, ply }, name)
      // Hậu kiểm riêng từng khoảnh khắc với tập nước của chính nó.
      const own = parts.find((p) => p.ply === ply)!.d.allowed
      const bad = findUnknownMoves(data, own)
      this.writeCache(key, MOVE, { data, warnings: bad.length ? [warnText(bad)] : undefined }, detail.row.id)
    }
  }

  // ---------------------------------------------------------------------------

  private build(req: ExplainRequest, name: string): { tpl: PromptTemplate; data: PromptData; key: string } {
    const model = this.settings.get().geminiModel
    const k = (tpl: PromptTemplate, ...parts: (string | number)[]): string =>
      createHash('sha1').update([tpl.kind, tpl.version, model, name, ...parts].join('|')).digest('hex')
    switch (req.kind) {
      case 'move': {
        const d = this.ctx.gameDetail(req.gameId)
        if (!d) throw new Error('Không tìm thấy ván')
        const m = d.moves[req.ply - 1]
        if (!m) throw new Error('Nước đi không tồn tại')
        return { tpl: MOVE, data: moveData(d, req.ply, name), key: k(MOVE, m.fenBefore, m.uci, d.row.userColor ?? '-') }
      }
      case 'position':
        throw new Error('Hãy dùng giải thích trong ván đã phân tích')
      case 'game': {
        const d = this.ctx.gameDetail(req.gameId)
        if (!d) throw new Error('Không tìm thấy ván')
        return { tpl: GAME, data: gameData(d, name), key: k(GAME, req.gameId, d.row.analysisStatus) }
      }
      case 'opening':
        return { tpl: OPENING, data: openingData(req.fen), key: k(OPENING, req.fen.split(' ').slice(0, 4).join(' ')) }
      case 'overview': {
        const data = overviewData(this.ctx.stats(), name)
        return { tpl: OVERVIEW, data, key: k(OVERVIEW, createHash('sha1').update(data.text).digest('hex')) }
      }
      case 'puzzle': {
        const p = this.ctx.puzzle(req.puzzleId)
        if (!p) throw new Error('Không tìm thấy puzzle')
        return {
          tpl: PUZZLE,
          data: puzzleData(p.fen, p.solution, p.motifs, p.playedSan, p.sourceClass, name),
          key: k(PUZZLE, p.fen, p.solution.join(' '))
        }
      }
    }
  }

  private async generate(
    tpl: PromptTemplate,
    data: PromptData,
    name: string,
    onChunk?: OnChunk
  ): Promise<{ data: Record<string, unknown>; warnings?: string[] }> {
    const key = this.settings.getGeminiKey()
    if (!key) throw new Error('Chưa có Gemini API key (vào Cài đặt để nhập)')
    const ai = new GoogleGenAI({ apiKey: key })
    const model = this.settings.get().geminiModel
    let note = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await this.limiter.schedule(() =>
        this.withRetry(async () => {
          const stream = await ai.models.generateContentStream({
            model,
            contents: `DỮ LIỆU:\n${data.text}${note}`,
            config: {
              systemInstruction: systemInstruction(name, tpl.task),
              responseMimeType: 'application/json',
              responseJsonSchema: tpl.schema,
              temperature: 0.4,
              abortSignal: AbortSignal.timeout(TIMEOUT_MS)
            }
          })
          let acc = ''
          for await (const chunk of stream) {
            acc += chunk.text ?? ''
            onChunk?.(acc)
          }
          return acc
        })
      )
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(text) as Record<string, unknown>
      } catch {
        throw new Error('Gemini trả về dữ liệu không đúng định dạng JSON')
      }
      const bad = data.allowed.size > 0 || tpl.kind !== 'overview' ? findUnknownMoves(parsed, data.allowed) : []
      if (bad.length === 0) return { data: parsed }
      if (attempt === 0) {
        this.log(`Gemini nhắc nước không có trong dữ liệu: ${bad.join(', ')} → gọi lại 1 lần`)
        note = `\n\nLƯU Ý: Lần trước bạn đã nhắc tới các nước KHÔNG có trong dữ liệu (${bad.join(', ')}). Chỉ dùng nước có trong DỮ LIỆU.`
        continue
      }
      return { data: parsed, warnings: [warnText(bad)] }
    }
    throw new Error('unreachable')
  }

  /** Retry với exponential backoff khi gặp 429 (hết lượt theo phút); hết quota ngày thì báo luôn. */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn()
      } catch (e) {
        const status = (e as { status?: number }).status
        const msg = e instanceof Error ? e.message : String(e)
        if (status === 429 || /RESOURCE_EXHAUSTED/.test(msg)) {
          if (/PerDay|per day|daily/i.test(msg)) throw new QuotaError(msg)
          if (attempt < MAX_429_RETRIES) {
            await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
            continue
          }
        }
        throw e
      }
    }
  }

  private readCache(key: string): { data: Record<string, unknown>; warnings?: string[] } | null {
    const row = this.db.prepare('SELECT response, warnings FROM explanations_cache WHERE key = ?').get(key) as
      | { response: string; warnings: string | null }
      | undefined
    if (!row) return null
    return { data: JSON.parse(row.response) as Record<string, unknown>, warnings: row.warnings ? (JSON.parse(row.warnings) as string[]) : undefined }
  }

  private writeCache(
    key: string,
    tpl: PromptTemplate,
    r: { data: Record<string, unknown>; warnings?: string[] },
    gameId: number | null = null
  ): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO explanations_cache (key, kind, model, prompt_version, response, warnings, created_at, game_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        key,
        tpl.kind,
        this.settings.get().geminiModel,
        tpl.version,
        JSON.stringify(r.data),
        r.warnings ? JSON.stringify(r.warnings) : null,
        Date.now(),
        gameId
      )
  }
}

function warnText(bad: string[]): string {
  return `Lời giải thích nhắc tới nước không có trong phân tích của engine (${bad.join(', ')}) — hãy kiểm tra lại trên bàn cờ.`
}

export function friendly(e: unknown): string {
  if (e instanceof QuotaError) return 'Đã hết quota Gemini miễn phí trong ngày. Các tính năng khác vẫn dùng bình thường; thử lại vào ngày mai.'
  const status = (e as { status?: number }).status
  const msg = e instanceof Error ? e.message : String(e)
  if (status === 429) return 'Gemini đang giới hạn tốc độ (quá nhiều request/phút). Thử lại sau ít phút.'
  if (status === 400 && /API key/i.test(msg)) return 'Gemini API key không hợp lệ.'
  if (status === 403) return 'Gemini từ chối: kiểm tra API key hoặc quyền dùng model.'
  if (status === 404) return 'Không tìm thấy model Gemini (kiểm tra tên model trong Cài đặt).'
  if (/abort|timeout/i.test(msg)) return 'Gemini phản hồi quá lâu (hết thời gian chờ).'
  if (/fetch failed|ENOTFOUND|ECONN/i.test(msg)) return 'Không kết nối được tới Gemini (kiểm tra mạng).'
  return msg
}
