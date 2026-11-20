/**
 * Phát hiện motif chiến thuật bằng luật (rule-based), chạy trước khi gọi Gemini.
 * Kết quả có cấu trúc để (1) tô sáng ô trên bàn cờ, (2) đưa vào prompt làm căn cứ.
 *
 * Quy ước `side`: bên HƯỞNG LỢI / thực hiện chiến thuật (ví dụ: quân Đen bị treo → side = 'w').
 */
import { Chess, type Position } from 'chessops/chess'
import { attacks, between } from 'chessops/attacks'
import type { Board } from 'chessops/board'
import type { Color, Move, NormalMove, Role, Square } from 'chessops/types'
import { VALUE } from '../chess/material'
import { attackersTo, hangingPieces, seeCapture, seeMove } from '../chess/see'
import { colorChar, fromFen, legalMoves, opposite, parseUci, pieceLabel, squareName } from '../chess/position'
import { THRESHOLDS } from '../analysis/classify'

export type MotifKind =
  | 'hanging'
  | 'fork'
  | 'pin'
  | 'skewer'
  | 'discovered_attack'
  | 'discovered_check'
  | 'double_check'
  | 'mate'
  | 'mate_threat'
  | 'back_rank'
  | 'overloaded'
  | 'sacrifice'

export interface Motif {
  kind: MotifKind
  side: 'w' | 'b'
  /** Ô liên quan; ô đầu tiên là ô chính (quân thực hiện / quân bị đe dọa). */
  squares: string[]
  /** Mô tả ngắn bằng tiếng Việt, dùng cho UI và prompt. */
  text: string
}

export const MOTIF_VI: Record<MotifKind, string> = {
  hanging: 'Quân bị treo (hanging)',
  fork: 'Nĩa (fork)',
  pin: 'Ghim (pin)',
  skewer: 'Xiên (skewer)',
  discovered_attack: 'Tấn công mở (discovered attack)',
  discovered_check: 'Chiếu mở (discovered check)',
  double_check: 'Chiếu kép (double check)',
  mate: 'Chiếu hết (checkmate)',
  mate_threat: 'Đe dọa chiếu hết (mate threat)',
  back_rank: 'Yếu hàng cuối (back rank)',
  overloaded: 'Quân phòng thủ quá tải (overloaded)',
  sacrifice: 'Thí quân (sacrifice)'
}

const COLOR_VI = (c: Color): string => (c === 'white' ? 'Trắng' : 'Đen')
const label = (board: Board, s: Square): string => pieceLabel(board.getRole(s)!, s)

/** Quân `target` có "đáng" bị tấn công không: giá trị lớn hơn quân tấn công, hoặc không được bảo vệ. */
function isValuableTarget(board: Board, target: Square, attackerRole: Role, occupied = board.occupied): boolean {
  const role = board.getRole(target)!
  const color = board.getColor(target)!
  if (role === 'king') return true
  if (VALUE[role] > VALUE[attackerRole]) return true
  return attackersTo(board, target, color, occupied.without(target)).isEmpty() && VALUE[role] >= 1
}

// ---------------------------------------------------------------------------
// Motif của một nước đi

function forks(after: Position, move: NormalMove, mover: Color): Motif[] {
  const board = after.board
  const role = board.getRole(move.to)!
  if (role === 'king') return []
  // Quân vừa đi phải không bị ăn mất trắng (nếu bị ăn có lãi thì nĩa vô nghĩa).
  if (seeCapture(board, move.to, opposite(mover)) > 0 && !after.isCheck()) return []
  const targets = [...attacks({ color: mover, role }, move.to, board.occupied).intersect(board[opposite(mover)])].filter((t) => isValuableTarget(board, t, role))
  if (targets.length < 2) return []
  return [
    {
      kind: 'fork',
      side: colorChar(mover),
      squares: [squareName(move.to), ...targets.map(squareName)],
      text: `${label(board, move.to)} tấn công cùng lúc ${targets.map((t) => label(board, t)).join(', ')}`
    }
  ]
}

const ROOK_DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const BISHOP_DIRS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]]

/** Duyệt các tia của quân trượt; trả về các cặp (quân đầu tiên, quân thứ hai) đều của đối phương. */
function rayPairs(board: Board, from: Square): { first: Square; second: Square }[] {
  const role = board.getRole(from)
  const color = board.getColor(from)
  if (!role || !color) return []
  const dirs = role === 'rook' ? ROOK_DIRS : role === 'bishop' ? BISHOP_DIRS : role === 'queen' ? [...ROOK_DIRS, ...BISHOP_DIRS] : []
  const out: { first: Square; second: Square }[] = []
  for (const [df, dr] of dirs) {
    let f = (from & 7) + df
    let r = (from >> 3) + dr
    let first: Square | undefined
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const s = r * 8 + f
      if (board.occupied.has(s)) {
        if (board.getColor(s) === color) break
        if (first === undefined) first = s
        else {
          out.push({ first, second: s })
          break
        }
      }
      f += df
      r += dr
    }
  }
  return out
}

/** Ghim và xiên do các quân trượt của `attacker` tạo ra (tùy chọn: chỉ từ ô `onlyFrom`). */
function pinsAndSkewers(board: Board, attacker: Color, onlyFrom?: Square): Motif[] {
  const out: Motif[] = []
  const sliders = board[attacker].intersect(board.bishop.union(board.rook).union(board.queen))
  for (const s of sliders) {
    if (onlyFrom !== undefined && s !== onlyFrom) continue
    const sliderRole = board.getRole(s)!
    for (const { first, second } of rayPairs(board, s)) {
      const r1 = board.getRole(first)!
      const r2 = board.getRole(second)!
      const worthTaking = (t: Square, r: Role): boolean =>
        r === 'king' || VALUE[r] > VALUE[sliderRole] || attackersTo(board, t, opposite(attacker), board.occupied.without(first)).isEmpty()
      if (r1 !== 'king' && VALUE[r2] > VALUE[r1] && worthTaking(second, r2)) {
        out.push({
          kind: 'pin',
          side: colorChar(attacker),
          squares: [squareName(first), squareName(s), squareName(second)],
          text:
            r2 === 'king'
              ? `${label(board, s)} ghim tuyệt đối ${label(board, first)} vào vua`
              : `${label(board, s)} ghim ${label(board, first)} vào ${label(board, second)}`
        })
      } else if ((r1 === 'king' || VALUE[r1] > VALUE[r2]) && r2 !== 'pawn' && worthTaking(second, r2)) {
        out.push({
          kind: 'skewer',
          side: colorChar(attacker),
          squares: [squareName(first), squareName(s), squareName(second)],
          text: `${label(board, s)} xiên ${label(board, first)}, sau đó ăn ${label(board, second)}`
        })
      }
    }
  }
  return out
}

function discovered(before: Position, after: Position, move: NormalMove, mover: Color): Motif[] {
  const out: Motif[] = []
  const enemy = opposite(mover)
  const b0 = before.board
  const b1 = after.board
  const enemyKing = b1.kingOf(enemy)
  const checkers = enemyKing !== undefined ? attackersTo(b1, enemyKing, mover) : undefined
  const movedChecks = checkers?.has(move.to) ?? false
  const sliders = b1[mover].intersect(b1.bishop.union(b1.rook).union(b1.queen)).without(move.to)
  for (const s of sliders) {
    const role = b1.getRole(s)!
    const now = attacks({ color: mover, role }, s, b1.occupied).intersect(b1[enemy])
    const was = attacks({ color: mover, role }, s, b0.occupied)
    for (const t of now.diff(was)) {
      if (!between(s, t).has(move.from)) continue // phải do quân vừa đi "mở" đường
      const tRole = b1.getRole(t)!
      if (tRole === 'king') {
        out.push({
          kind: movedChecks ? 'double_check' : 'discovered_check',
          side: colorChar(mover),
          squares: [squareName(s), squareName(move.to), squareName(t)],
          text: movedChecks
            ? `Chiếu kép: ${label(b1, move.to)} và ${label(b1, s)} cùng chiếu vua`
            : `${label(b1, move.to)} di chuyển mở đường cho ${label(b1, s)} chiếu vua`
        })
      } else if (isValuableTarget(b1, t, role)) {
        out.push({
          kind: 'discovered_attack',
          side: colorChar(mover),
          squares: [squareName(s), squareName(move.to), squareName(t)],
          text: `${label(b1, move.to)} di chuyển mở đường cho ${label(b1, s)} tấn công ${label(b1, t)}`
        })
      }
    }
  }
  return out
}

function sacrifice(before: Position, after: Position, move: NormalMove, mover: Color): Motif[] {
  const see = seeMove(before.board, move)
  if (see <= -THRESHOLDS.sacrificeMin) {
    return [
      {
        kind: 'sacrifice',
        side: colorChar(mover),
        squares: [squareName(move.to)],
        text: `Thí ${label(after.board, move.to)} (mất khoảng ${-see} điểm vật chất nếu đối phương ăn)`
      }
    ]
  }
  // Thí gián tiếp: nước đi để một quân KHÁC bị treo mà trước đó không treo.
  const hungBefore = new Set(hangingPieces(before.board, mover).map((h) => h.square))
  const newly = hangingPieces(after.board, mover).filter(
    (h) => h.square !== move.to && !hungBefore.has(h.square) && h.loss >= THRESHOLDS.sacrificeMin
  )
  return newly.map((h) => ({
    kind: 'sacrifice' as const,
    side: colorChar(mover),
    squares: [squareName(h.square)],
    text: `Để ${pieceLabel(h.role, h.square)} cho đối phương ăn (thí ${h.loss} điểm)`
  }))
}

/** Nước đi có phải thí quân không (theo SEE, kể cả để quân khác bị treo). */
export function isSacrifice(before: Position, move: Move): boolean {
  if (!('from' in move) || before.board.getColor(move.to) === before.turn) return false // nhập thành
  const after = before.clone()
  after.play(move)
  return sacrifice(before, after, move, before.turn).length > 0
}

/** Motif do nước `move` tạo ra (góc nhìn người đi). */
export function moveMotifs(before: Position, rawMove: Move): Motif[] {
  if (!('from' in rawMove)) return []
  const mover = before.turn
  const after = before.clone()
  after.play(rawMove)
  // chessops mã hóa nhập thành là "vua đi tới ô xe": quy về ô thật của vua sau khi nhập thành.
  const castling = before.board.getColor(rawMove.to) === mover
  const move: NormalMove = castling ? { from: rawMove.from, to: after.board.kingOf(mover)! } : rawMove
  if (after.isCheckmate()) {
    return [{ kind: 'mate', side: colorChar(mover), squares: [squareName(move.to)], text: 'Chiếu hết' }]
  }
  return [
    ...forks(after, move, mover),
    ...pinsAndSkewers(after.board, mover, move.to),
    ...discovered(before, after, move, mover),
    ...(castling ? [] : sacrifice(before, after, move, mover))
  ]
}

// ---------------------------------------------------------------------------
// Motif của một vị trí tĩnh

/** Nước chiếu hết trong 1 của bên đang đi (nếu có). */
export function mateInOne(pos: Position): Move | null {
  for (const m of legalMoves(pos)) {
    const p = pos.clone()
    p.play(m)
    if (p.isCheckmate()) return m
  }
  return null
}

/** Bên KHÔNG đi có đe dọa chiếu hết 1 nước không (nếu được đi tiếp)? Dùng "nước đi rỗng". */
function mateThreat(pos: Position): Motif[] {
  if (pos.isCheck()) return []
  const setup = pos.toSetup()
  const flipped = Chess.fromSetup({ ...setup, turn: opposite(pos.turn), epSquare: undefined })
  if (flipped.isErr) return []
  const m = mateInOne(flipped.unwrap())
  if (!m || !('from' in m)) return []
  const threatener = opposite(pos.turn)
  return [
    {
      kind: 'mate_threat',
      side: colorChar(threatener),
      squares: [squareName(m.from), squareName(m.to)],
      text: `${COLOR_VI(threatener)} đe dọa chiếu hết bằng ${label(pos.board, m.from)}-${squareName(m.to)}`
    }
  ]
}

function backRank(board: Board): Motif[] {
  const out: Motif[] = []
  for (const color of ['white', 'black'] as const) {
    const king = board.kingOf(color)
    if (king === undefined) continue
    const backRankIdx = color === 'white' ? 0 : 7
    if (king >> 3 !== backRankIdx) continue
    const enemy = opposite(color)
    const heavy = board[enemy].intersect(board.rook.union(board.queen))
    if (heavy.isEmpty()) continue
    // Ô thoát: ô quanh vua NGOÀI hàng cuối (xe/hậu chiếu theo hàng sẽ khống chế cả hàng cuối),
    // không có quân mình và không bị tấn công.
    const escape = [...attacks({ color, role: 'king' }, king, board.occupied).diff(board[color])].filter(
      (s) => s >> 3 !== backRankIdx
    ).filter((s) => attackersTo(board, s, enemy, board.occupied.without(king)).isEmpty())
    if (escape.length > 0) continue
    // Có quân nặng đối phương với tới hàng cuối (cột mở).
    const reaches = [...heavy].some((h) =>
      [...attacks({ color: enemy, role: 'rook' }, h, board.occupied)].some((s) => s >> 3 === backRankIdx)
    )
    if (!reaches) continue
    out.push({
      kind: 'back_rank',
      side: colorChar(enemy),
      squares: [squareName(king)],
      text: `Vua ${COLOR_VI(color)} ở ${squareName(king)} không có ô thoát, hàng cuối yếu`
    })
  }
  return out
}

function overloaded(board: Board): Motif[] {
  const out: Motif[] = []
  for (const color of ['white', 'black'] as const) {
    const enemy = opposite(color)
    for (const d of board[color].diff(board.king)) {
      const defended = attacks(board.get(d)!, d, board.occupied).intersect(board[color])
      const duties: Square[] = []
      for (const t of defended) {
        if (attackersTo(board, t, enemy).isEmpty()) continue
        if (seeCapture(board, t, enemy) > 0) continue // đã treo sẵn, không phải do quá tải
        const without = board.clone()
        without.take(d)
        if (seeCapture(without, t, enemy) > 0) duties.push(t)
      }
      if (duties.length >= 2) {
        out.push({
          kind: 'overloaded',
          side: colorChar(enemy),
          squares: [squareName(d), ...duties.map(squareName)],
          text: `${label(board, d)} của ${COLOR_VI(color)} phải bảo vệ cùng lúc ${duties.map((t) => label(board, t)).join(', ')}`
        })
      }
    }
  }
  return out
}

function hanging(board: Board): Motif[] {
  const out: Motif[] = []
  for (const color of ['white', 'black'] as const) {
    for (const h of hangingPieces(board, color)) {
      out.push({
        kind: 'hanging',
        side: colorChar(opposite(color)),
        squares: [squareName(h.square)],
        text: `${pieceLabel(h.role, h.square)} của ${COLOR_VI(color)} bị treo (đối phương lãi ${h.loss} điểm nếu ăn)`
      })
    }
  }
  return out
}

/** Motif tĩnh của một vị trí: quân treo, ghim/xiên, đe dọa chiếu hết, hàng cuối, quá tải. */
export function positionMotifs(pos: Position): Motif[] {
  return [
    ...hanging(pos.board),
    ...pinsAndSkewers(pos.board, 'white'),
    ...pinsAndSkewers(pos.board, 'black'),
    ...mateThreat(pos),
    ...backRank(pos.board),
    ...overloaded(pos.board)
  ]
}

/** Motif dọc theo một biến (PV của engine), tối đa `maxPlies` nước. Bỏ trùng. */
export function lineMotifs(fen: string, pv: string[], maxPlies = 4): Motif[] {
  const pos = fromFen(fen)
  const out: Motif[] = []
  const seen = new Set<string>()
  for (const uci of pv.slice(0, maxPlies)) {
    const move = parseUci(uci)
    if (!move || !pos.isLegal(move)) break
    for (const m of moveMotifs(pos, move)) {
      const key = `${m.kind}:${m.squares.join(',')}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push(m)
      }
    }
    pos.play(move)
  }
  return out
}

/** Tiện ích cho test/IPC: motif của nước UCI tại FEN. */
export function moveMotifsFen(fen: string, uci: string): Motif[] {
  const pos = fromFen(fen)
  const move = parseUci(uci)
  return move && pos.isLegal(move) ? moveMotifs(pos, move) : []
}

export function positionMotifsFen(fen: string): Motif[] {
  return positionMotifs(fromFen(fen))
}
