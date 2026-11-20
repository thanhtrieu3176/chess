import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Chessground } from 'chessground'
import type { Api as CgApi } from 'chessground/api'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import { chessgroundDests } from 'chessops/compat'
import { fromFen } from '@shared/chess/position'
import { parseSquare } from 'chessops/util'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'
import '../assets/pieces-merida.css'
import '../assets/pieces-alpha.css'
import '../assets/boards.css'
import { useApp } from '../store'

export interface BoardProps {
  fen: string
  orientation: 'white' | 'black'
  lastMove?: string | null
  /** Cho phép đi quân của bên đang đi (mặc định true). */
  movable?: boolean
  /** Chỉ cho đi quân của một màu (ví dụ puzzle: chỉ màu của tôi). */
  onlyColor?: 'white' | 'black'
  onMove?: (uci: string) => void
  shapes?: DrawShape[]
  /** Đổi giá trị để buộc bàn cờ đồng bộ lại theo `fen` (ví dụ sau khi từ chối một nước đi sai). */
  syncKey?: number
}

const PROMO = ['q', 'r', 'b', 'n'] as const
const PROMO_ROLE = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' } as const

/** Bàn cờ chessground (của Lichess). Chỉ cập nhật phần thay đổi qua cg.set() để không render lại thừa. */
export const Board = memo(function Board({ fen, orientation, lastMove, movable = true, onlyColor, onMove, shapes, syncKey }: BoardProps) {
  const el = useRef<HTMLDivElement>(null)
  const cg = useRef<CgApi | null>(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null)
  const { settings } = useApp()

  const pos = useMemo(() => {
    try {
      return fromFen(fen)
    } catch {
      return null
    }
  }, [fen])
  const turn = pos?.turn ?? 'white'

  useEffect(() => {
    if (!el.current) return
    cg.current = Chessground(el.current, {
      coordinates: true,
      animation: { duration: 180 },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: true, visible: true },
      movable: { free: false, showDests: true },
      premovable: { enabled: false }
    })
    return () => cg.current?.destroy()
  }, [])

  useEffect(() => {
    const api = cg.current
    if (!api || !pos) return
    const canMove = movable && !pos.isEnd() && (!onlyColor || onlyColor === turn)
    api.set({
      fen,
      orientation,
      turnColor: turn,
      check: pos.isCheck() ? turn : false,
      lastMove: lastMove ? ([lastMove.slice(0, 2), lastMove.slice(2, 4)] as Key[]) : undefined,
      movable: {
        color: canMove ? turn : undefined,
        dests: canMove ? (chessgroundDests(pos) as Map<Key, Key[]>) : new Map(),
        events: {
          after: (orig, dest) => {
            const from = parseSquare(orig)!
            const toRank = dest[1]
            if (pos.board.getRole(from) === 'pawn' && (toRank === '8' || toRank === '1')) setPromo({ from: orig, to: dest })
            else onMoveRef.current?.(orig + dest)
          }
        }
      }
    })
  }, [fen, orientation, lastMove, movable, onlyColor, pos, turn, syncKey])

  useEffect(() => {
    cg.current?.setAutoShapes(shapes ?? [])
  }, [shapes])

  const pick = (p: (typeof PROMO)[number]) => {
    if (promo) onMoveRef.current?.(promo.from + promo.to + p)
    setPromo(null)
  }

  return (
    <div className={`relative aspect-square w-full board-${settings?.boardTheme ?? 'brown'} pieces-${settings?.pieceSet ?? 'cburnett'}`}>
      <div ref={el} className="h-full w-full" />
      {promo && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50" onClick={() => {
          setPromo(null)
          cg.current?.set({ fen })
        }}>
          <div className="flex gap-2 rounded-lg bg-panel p-3" onClick={(e) => e.stopPropagation()}>
            {PROMO.map((p) => (
              <button key={p} className="h-16 w-16 rounded bg-panel-2 hover:bg-line" onClick={() => pick(p)}>
                <div className="cg-wrap h-full w-full">
                  <piece className={`${PROMO_ROLE[p]} ${turn}`} style={{ width: '100%', height: '100%', position: 'relative', display: 'block' }} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

/** Mũi tên/vòng tròn/ký hiệu trên bàn cờ. */
export const arrow = (uci: string, brush: string, lineWidth?: number): DrawShape => ({
  orig: uci.slice(0, 2) as Key,
  dest: uci.slice(2, 4) as Key,
  brush,
  modifiers: lineWidth ? { lineWidth } : undefined
})

export const circle = (sq: string, brush: string): DrawShape => ({ orig: sq as Key, brush })

/** Ký hiệu phân loại (!!, ??, ...) ở góc trên phải ô đích. */
export function badge(sq: string, symbol: string, color: string): DrawShape {
  const text = symbol.length > 2 ? '' : symbol
  return {
    orig: sq as Key,
    customSvg: {
      html: `<g transform="translate(86 14)"><circle r="17" fill="${color}" stroke="#fff" stroke-width="2.5"/>${
        text
          ? `<text text-anchor="middle" dominant-baseline="central" font-size="${text.length > 1 ? 17 : 21}" font-weight="700" fill="#fff" font-family="Segoe UI, sans-serif">${text}</text>`
          : '<circle r="5" fill="#fff"/>'
      }</g>`
    }
  }
}
