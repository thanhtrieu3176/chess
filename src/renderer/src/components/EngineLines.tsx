import { memo, useMemo } from 'react'
import type { EngineLine } from '@shared/types'
import { formatScore } from '@shared/analysis/winPercent'
import { fromFen, pvToSan } from '@shared/chess/position'

interface Props {
  fen: string
  lines: EngineLine[]
  depth?: number
  /** Bấm một nước trong biến → đi biến tới nước đó (index trong PV). */
  onPlay?: (pv: string[], upto: number) => void
}

/** Top biến của engine (MultiPV), hiển thị SAN có số nước. */
export const EngineLines = memo(function EngineLines({ fen, lines, depth, onPlay }: Props) {
  const rendered = useMemo(() => {
    let start: { num: number; white: boolean }
    try {
      const p = fromFen(fen)
      start = { num: p.fullmoves, white: p.turn === 'white' }
    } catch {
      return []
    }
    return lines.map((l) => ({ line: l, sans: pvToSan(fen, l.pv, 14), start }))
  }, [fen, lines])

  if (rendered.length === 0) return <div className="text-sm text-muted">Chưa có biến.</div>
  return (
    <div className="space-y-1 text-sm">
      {depth !== undefined && depth > 0 && <div className="text-xs text-muted">Độ sâu {depth}</div>}
      {rendered.map(({ line, sans, start }) => {
        let num = start.num
        let white = start.white
        return (
          <div key={line.multipv} className="flex gap-2">
            <span
              className={`w-14 shrink-0 rounded px-1 text-center font-mono text-xs leading-5 ${
                (line.score.mate ?? line.score.cp ?? 0) >= 0 ? 'bg-[#f0f0f0] text-[#222]' : 'bg-[#403d39] text-white'
              }`}
            >
              {formatScore(line.score)}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {sans.map((san, i) => {
                const label = white ? `${num}. ` : i === 0 ? `${num}... ` : ''
                if (!white) num++
                white = !white
                return (
                  <button key={i} className="mr-1 rounded px-0.5 hover:bg-line" onClick={() => onPlay?.(line.pv, i)}>
                    <span className="text-muted">{label}</span>
                    {san}
                  </button>
                )
              })}
            </span>
            {onPlay && (
              <button className="shrink-0 text-xs text-accent hover:underline" onClick={() => onPlay(line.pv, 0)} title="Đi từng nước trong biến này">
                Xem biến
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
})
