/** Cây khai cuộc cá nhân (repertoire) cho từng màu + kiểm tra lệch repertoire trong ván. */
import type { DatabaseSync } from 'node:sqlite'
import type { GameMove, RepertoireCheck, RepertoireNode } from '@shared/types'
import { normalizeFen, START_FEN } from '@shared/fen'
import { playUci } from '@shared/chess/position'
import { MoveTree, type TreeNode } from '@shared/tree'
import { transaction } from '../db'

interface Row {
  id: number
  color: 'w' | 'b'
  parent_id: number | null
  parent_fen: string
  fen: string
  uci: string
  san: string
  comment: string | null
}

const toNode = (r: Row): RepertoireNode => ({
  id: r.id,
  color: r.color,
  parentId: r.parent_id,
  parentFen: r.parent_fen,
  fen: r.fen,
  uci: r.uci,
  san: r.san,
  comment: r.comment ?? ''
})

export class RepertoireRepo {
  constructor(private readonly db: DatabaseSync) {}

  list(color: 'w' | 'b'): RepertoireNode[] {
    return (this.db.prepare('SELECT * FROM repertoire_nodes WHERE color = ? ORDER BY id').all(color) as unknown as Row[]).map(toNode)
  }

  /** Thêm nước `uci` sau nút `parentId` (null = vị trí ban đầu). Trả nút (có sẵn hoặc mới). */
  addMove(color: 'w' | 'b', parentId: number | null, uci: string): RepertoireNode {
    const parentFen = parentId === null ? START_FEN : this.node(parentId)?.fen
    if (!parentFen) throw new Error('Không tìm thấy nút cha')
    const existing = this.db
      .prepare('SELECT * FROM repertoire_nodes WHERE color = ? AND parent_id IS ? AND uci = ?')
      .get(color, parentId, uci) as Row | undefined
    if (existing) return toNode(existing)
    const r = playUci(parentFen, uci)
    if (!r) throw new Error('Nước đi không hợp lệ')
    const info = this.db
      .prepare('INSERT INTO repertoire_nodes (color, parent_id, parent_fen, fen, uci, san, comment) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(color, parentId, normalizeFen(parentFen), r.fen, uci, r.san, '')
    return this.node(Number(info.lastInsertRowid))!
  }

  setComment(id: number, comment: string): void {
    this.db.prepare('UPDATE repertoire_nodes SET comment = ? WHERE id = ?').run(comment, id)
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM repertoire_nodes WHERE id = ?').run(id)
  }

  /** Nhập PGN (kèm mọi biến phụ và chú thích) vào repertoire của một màu. */
  importPgn(color: 'w' | 'b', pgn: string): number {
    const tree = MoveTree.fromPgn(pgn)
    if (normalizeFen(tree.root.fen) !== normalizeFen(START_FEN)) throw new Error('Repertoire phải bắt đầu từ vị trí ban đầu')
    let added = 0
    transaction(this.db, () => {
      const walk = (src: TreeNode, parentId: number | null): void => {
        for (const child of src.children) {
          const before = this.count()
          const n = this.addMove(color, parentId, child.uci)
          if (this.count() > before) added++
          if (child.comment && !n.comment) this.setComment(n.id, child.comment)
          walk(child, n.id)
        }
      }
      walk(tree.root, null)
    })
    return added
  }

  /** Các nước trong repertoire tại vị trí `fen` (khớp cả transposition). */
  movesAt(color: 'w' | 'b', fen: string): { uci: string; san: string; comment: string }[] {
    const rows = this.db
      .prepare('SELECT uci, san, comment FROM repertoire_nodes WHERE color = ? AND parent_fen = ?')
      .all(color, normalizeFen(fen)) as { uci: string; san: string; comment: string | null }[]
    const seen = new Set<string>()
    return rows.filter((r) => !seen.has(r.uci) && seen.add(r.uci)).map((r) => ({ ...r, comment: r.comment ?? '' }))
  }

  /**
   * So ván với repertoire của màu tôi cầm: báo nước đầu tiên tôi đi khác repertoire,
   * hoặc nước đối thủ đi mà repertoire chưa chuẩn bị.
   */
  check(userColor: 'w' | 'b' | null, moves: GameMove[]): RepertoireCheck | null {
    if (!userColor) return null
    for (const m of moves) {
      const options = this.movesAt(userColor, m.fenBefore)
      if (options.length === 0) return null // đã ra khỏi repertoire (hoặc chưa có)
      if (options.some((o) => o.uci === m.uci)) continue
      const moveNo = `${Math.ceil(m.ply / 2)}${m.color === 'w' ? '.' : '...'}`
      const expected = options.map((o) => o.san)
      return m.color === userColor
        ? {
            ply: m.ply,
            kind: 'user_deviated',
            played: m.san,
            expected,
            message: `Bạn đã lệch repertoire ở nước ${moveNo} (đi ${m.san} thay vì ${expected.join(' / ')})`
          }
        : {
            ply: m.ply,
            kind: 'opponent_novelty',
            played: m.san,
            expected,
            message: `Đối thủ đi ${moveNo} ${m.san}, nước ngoài repertoire (bạn mới chuẩn bị ${expected.join(' / ')})`
          }
    }
    return null
  }

  private node(id: number): RepertoireNode | null {
    const r = this.db.prepare('SELECT * FROM repertoire_nodes WHERE id = ?').get(id) as Row | undefined
    return r ? toNode(r) : null
  }

  private count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM repertoire_nodes').get() as { n: number }).n
  }
}
