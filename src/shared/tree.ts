/**
 * Cây nước đi có nhánh (dùng cho màn hình Phân tích/Sandbox).
 * children[0] luôn là biến chính; các phần tử sau là biến phụ.
 * Cây là cấu trúc mutable; UI theo dõi thay đổi bằng một bộ đếm phiên bản.
 */
import { parseComment, parsePgn, startingPosition, type PgnNodeData, type Node as PgnNode } from 'chessops/pgn'
import { makeSanAndPlay, parseSan } from 'chessops/san'
import { fromFen, playUci, toFen } from './chess/position'
import { makeUci } from 'chessops/util'

export interface TreeNode {
  id: number
  /** Số nửa nước tính từ vị trí gốc (gốc = 0). */
  ply: number
  san: string
  uci: string
  fen: string
  comment: string
  children: TreeNode[]
  parent: TreeNode | null
}

let nextId = 1

function makeNode(parent: TreeNode | null, san: string, uci: string, fen: string, comment = ''): TreeNode {
  return { id: nextId++, ply: parent ? parent.ply + 1 : 0, san, uci, fen, comment, children: [], parent }
}

export class MoveTree {
  readonly root: TreeNode
  private byId = new Map<number, TreeNode>()

  constructor(startFen: string) {
    this.root = makeNode(null, '', '', startFen)
    this.byId.set(this.root.id, this.root)
  }

  /** Cây chỉ có biến chính (từ danh sách nước của một ván). */
  static fromMainline(startFen: string, moves: { san: string; uci: string; fenAfter: string }[]): MoveTree {
    const t = new MoveTree(startFen)
    let cur = t.root
    for (const m of moves) cur = t.attach(cur, makeNode(cur, m.san, m.uci, m.fenAfter))
    return t
  }

  /** Đọc PGN có biến phụ và chú thích (chỉ ván đầu tiên). */
  static fromPgn(pgn: string): MoveTree {
    const game = parsePgn(pgn)[0]
    if (!game) throw new Error('PGN trống')
    const pos = startingPosition(game.headers).unwrap()
    const t = new MoveTree(toFen(pos))
    const walk = (src: PgnNode<PgnNodeData>, dst: TreeNode, fen: string): void => {
      for (const child of src.children) {
        const p = fromFen(fen)
        const move = parseSan(p, child.data.san)
        if (!move) continue
        const san = makeSanAndPlay(p, move)
        const comment = (child.data.comments ?? []).map((c) => parseComment(c).text).join(' ').trim()
        const node = t.attach(dst, makeNode(dst, san, makeUci(move), toFen(p), comment))
        walk(child, node, node.fen)
      }
    }
    walk(game.moves, t.root, t.root.fen)
    return t
  }

  get(id: number): TreeNode | undefined {
    return this.byId.get(id)
  }

  /** Đi nước `uci` từ `node`: trả về nhánh có sẵn nếu đã có, ngược lại tạo nhánh mới (biến phụ). */
  addMove(node: TreeNode, uci: string): TreeNode | null {
    const existing = node.children.find((c) => c.uci === uci)
    if (existing) return existing
    const r = playUci(node.fen, uci)
    if (!r) return null
    return this.attach(node, makeNode(node, r.san, uci, r.fen))
  }

  /** Xóa nút và toàn bộ nhánh con; trả về nút cha. */
  delete(node: TreeNode): TreeNode | null {
    const parent = node.parent
    if (!parent) return null
    parent.children = parent.children.filter((c) => c !== node)
    const drop = (n: TreeNode): void => {
      this.byId.delete(n.id)
      n.children.forEach(drop)
    }
    drop(node)
    return parent
  }

  /** Nâng nhánh chứa `node` thành biến chính (đưa lên vị trí đầu ở mọi tổ tiên). */
  promote(node: TreeNode): void {
    let n: TreeNode = node
    while (n.parent) {
      const siblings = n.parent.children
      const i = siblings.indexOf(n)
      if (i > 0) {
        siblings.splice(i, 1)
        siblings.unshift(n)
      }
      n = n.parent
    }
  }

  isMainline(node: TreeNode): boolean {
    let n = node
    while (n.parent) {
      if (n.parent.children[0] !== n) return false
      n = n.parent
    }
    return true
  }

  mainline(): TreeNode[] {
    const out: TreeNode[] = []
    let n = this.root.children[0]
    while (n) {
      out.push(n)
      n = n.children[0]
    }
    return out
  }

  /** Đường đi từ gốc tới `node` (không gồm gốc). */
  path(node: TreeNode): TreeNode[] {
    const out: TreeNode[] = []
    let n: TreeNode | null = node
    while (n && n.parent) {
      out.unshift(n)
      n = n.parent
    }
    return out
  }

  /** Xuất PGN có biến phụ và chú thích. */
  toPgn(headers: Record<string, string> = {}): string {
    const h: Record<string, string> = { Event: '?', Site: '?', Date: '????.??.??', White: '?', Black: '?', Result: '*', ...headers }
    if (this.root.fen !== START && !h.FEN) {
      h.SetUp = '1'
      h.FEN = this.root.fen
    }
    const head = Object.entries(h)
      .map(([k, v]) => `[${k} "${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`)
      .join('\n')
    const body = this.renderChildren(this.root, true).join(' ')
    return `${head}\n\n${body ? body + ' ' : ''}${h.Result}\n`
  }

  private moveText(node: TreeNode, forceNumber: boolean): string {
    const parentFen = node.parent!.fen.split(' ')
    const white = parentFen[1] === 'w'
    const num = Number(parentFen[5] ?? 1)
    const comment = node.comment ? ` {${node.comment.replaceAll('}', ')')}}` : ''
    if (white) return `${num}. ${node.san}${comment}`
    return `${forceNumber ? `${num}... ` : ''}${node.san}${comment}`
  }

  private renderChildren(parent: TreeNode, forceNumber: boolean): string[] {
    const [main, ...vars] = parent.children
    if (!main) return []
    const out = [this.moveText(main, forceNumber)]
    for (const v of vars) out.push(`(${[this.moveText(v, true), ...this.renderChildren(v, !!v.comment)].join(' ')})`)
    out.push(...this.renderChildren(main, vars.length > 0 || !!main.comment))
    return out
  }

  private attach(parent: TreeNode, node: TreeNode): TreeNode {
    parent.children.push(node)
    this.byId.set(node.id, node)
    return node
  }
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
