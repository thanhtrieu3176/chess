import { memo } from 'react'
import type { Score } from '@shared/types'
import { formatScore, winPercent } from '@shared/analysis/winPercent'

/** Thanh điểm dọc cạnh bàn cờ (tỷ lệ theo Win% của Trắng). */
export const EvalBar = memo(function EvalBar({ score, orientation }: { score: Score | null; orientation: 'white' | 'black' }) {
  const w = score ? winPercent(score) : 50
  const whiteBottom = orientation === 'white'
  const label = score ? formatScore(score).replace(/^\+/, '') : ''
  const whiteAhead = w >= 50
  return (
    <div className={`relative flex h-full w-7 shrink-0 overflow-hidden rounded ${whiteBottom ? 'flex-col' : 'flex-col-reverse'} bg-[#f0f0f0]`}>
      <div className="bg-[#403d39] transition-all duration-300" style={{ height: `${100 - w}%` }} />
      <div
        className={`absolute left-0 right-0 text-center text-[10px] font-semibold ${whiteAhead === whiteBottom ? 'bottom-1 text-[#403d39]' : 'top-1 text-[#f0f0f0]'}`}
      >
        {label}
      </div>
    </div>
  )
})
