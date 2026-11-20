import { memo, useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { GameAnalysis } from '@shared/types'
import { CLASS_INFO } from '@shared/analysis/classify'
import { winPercent } from '@shared/analysis/winPercent'

const MARKED = new Set(['brilliant', 'great', 'mistake', 'miss', 'blunder'])

/** Biểu đồ lợi thế theo Win% của Trắng. Chấm màu = khoảnh khắc quan trọng; bấm để nhảy tới nước đó. */
export const EvalChart = memo(function EvalChart({
  analysis,
  ply,
  onSelect
}: {
  analysis: GameAnalysis
  ply: number
  onSelect: (ply: number) => void
}) {
  const data = useMemo(
    () =>
      analysis.positions.map((p, i) => {
        const m = i > 0 ? analysis.moves[i - 1] : null
        return { ply: i, win: p ? Math.round(winPercent(p.score) * 10) / 10 : null, cls: m?.classification ?? null }
      }),
    [analysis]
  )

  // Vạch trục X tại nước của Trắng, cách đều 5 hoặc 10 nước (tránh lặp số nước).
  const ticks = useMemo(() => {
    const moves = Math.ceil((data.length - 1) / 2)
    const step = moves > 60 ? 20 : moves > 30 ? 10 : 5
    const out: number[] = []
    for (let m = step; m <= moves; m += step) out.push((m - 1) * 2)
    return [0, ...out]
  }, [data.length])

  const Dot = (props: { cx?: number; cy?: number; payload?: { cls: string | null; ply: number } }) => {
    const { cx, cy, payload } = props
    if (!payload?.cls || !MARKED.has(payload.cls) || cx === undefined || cy === undefined) return <g />
    const c = CLASS_INFO[payload.cls as keyof typeof CLASS_INFO]
    return <circle cx={cx} cy={cy} r={4.5} fill={c.color} stroke="#fff" strokeWidth={1.5} style={{ cursor: 'pointer' }} onClick={() => onSelect(payload.ply)} />
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
        margin={{ top: 6, right: 8, bottom: 0, left: -28 }}
        onClick={(e) => {
          const i = Number((e as { activeLabel?: string | number } | null)?.activeLabel)
          if (Number.isFinite(i)) onSelect(i)
        }}
      >
        <defs>
          <linearGradient id="evalFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f0f0f0" stopOpacity={0.95} />
            <stop offset="100%" stopColor="#f0f0f0" stopOpacity={0.75} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--color-line)" vertical={false} strokeDasharray="2 4" />
        <XAxis
          dataKey="ply"
          type="number"
          domain={[0, Math.max(1, data.length - 1)]}
          ticks={ticks}
          tick={{ fontSize: 10, fill: 'var(--color-muted)' }}
          tickFormatter={(v: number) => String(v / 2 + 1)}
        />
        <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 10, fill: 'var(--color-muted)' }} />
        <Tooltip
          contentStyle={{ background: 'var(--color-panel)', border: '1px solid var(--color-line)', fontSize: 12 }}
          labelFormatter={(v) => `Nửa nước ${v}`}
          formatter={(v) => [`${v}%`, 'Trắng thắng']}
        />
        <ReferenceLine y={50} stroke="var(--color-muted)" strokeOpacity={0.6} />
        <ReferenceLine x={ply} stroke="var(--color-accent)" strokeWidth={2} />
        <Area type="monotone" dataKey="win" stroke="#bdbdbd" fill="url(#evalFill)" baseValue={0} isAnimationActive={false} dot={<Dot />} activeDot={{ r: 3 }} connectNulls />
      </AreaChart>
    </ResponsiveContainer>
  )
})
