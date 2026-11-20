import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Ratings, Speed, Stats } from '@shared/types'
import { CLASS_INFO, CLASSIFICATIONS } from '@shared/analysis/classify'
import { PHASE_VI } from '@shared/chess/phase'
import { MOTIF_VI, type MotifKind } from '@shared/tactics'
import { useApp } from '../store'
import { Explanation } from '../components/Explanation'
import { Button } from '../components/ui'

const axis = { fontSize: 11, fill: 'var(--color-muted)' }
const tooltipStyle = { background: 'var(--color-panel)', border: '1px solid var(--color-line)', fontSize: 12, color: 'var(--color-fg)' }
const fmtDate = (t: number) => new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-panel p-4 ${className}`}>
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export default function StatsScreen() {
  const { settings, openGame } = useApp()
  const [stats, setStats] = useState<Stats | null>(null)
  const [ratings, setRatings] = useState<Ratings | null>(null)
  const [speed, setSpeed] = useState<Speed | 'all'>('all')
  const [color, setColor] = useState<'w' | 'b'>('w')

  useEffect(() => {
    void window.api.getStats().then(setStats)
    void window.api.getRatings().then(setRatings)
  }, [])

  const trend = useMemo(
    () => (stats?.accuracyTrend ?? []).filter((t) => speed === 'all' || t.speed === speed).map((t) => ({ ...t, accuracy: Math.round(t.accuracy * 10) / 10 })),
    [stats, speed]
  )
  const ratingTrend = useMemo(() => {
    const sp = speed === 'all' ? mostCommonSpeed(stats) : speed
    return (stats?.ratingTrend ?? []).filter((t) => t.speed === sp)
  }, [stats, speed])

  if (!stats) return <div className="p-8 text-muted">Đang tính thống kê...</div>
  if (stats.games === 0)
    return <div className="p-8 text-muted">Chưa có ván nào của bạn. Nhập hoặc tải ván ở Thư viện ván (username trong Cài đặt dùng để nhận ra ván của bạn).</div>

  const total = stats.record.win + stats.record.draw + stats.record.loss
  const pct = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : '—')
  const openings = stats.openings.filter((o) => o.color === color).slice(0, 12)

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Thống kê của {settings?.displayName}</h1>
        <select className="ml-auto rounded border border-line bg-panel-2 px-2 py-1 text-sm" value={speed} onChange={(e) => setSpeed(e.target.value as Speed | 'all')}>
          <option value="all">Mọi thể loại</option>
          {(['bullet', 'blitz', 'rapid', 'classical', 'daily'] as Speed[]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card title="Tổng số ván">
          <div className="text-3xl font-semibold">{stats.games}</div>
          <div className="text-sm text-muted">{stats.analyzed} ván đã phân tích</div>
        </Card>
        <Card title="Thắng / Hòa / Thua">
          <div className="text-2xl font-semibold">
            <span className="text-accent">{stats.record.win}</span> / <span className="text-muted">{stats.record.draw}</span> /{' '}
            <span className="text-danger">{stats.record.loss}</span>
          </div>
          <div className="text-sm text-muted">
            {pct(stats.record.win)} thắng · {pct(stats.record.loss)} thua
          </div>
        </Card>
        <Card title={`Rating Chess.com (${settings?.chesscomUsername})`} className="col-span-2">
          {!ratings ? (
            <div className="text-muted">Đang tải...</div>
          ) : !ratings.ok ? (
            <div className="text-sm text-muted">Không lấy được rating (offline?). {ratings.error}</div>
          ) : (
            <div className="flex gap-6">
              {ratings.bySpeed.map((r) => (
                <div key={r.speed}>
                  <div className="text-xs text-muted uppercase">{r.speed}</div>
                  <div className="text-2xl font-semibold">{r.rating}</div>
                  {r.best && <div className="text-xs text-muted">cao nhất {r.best}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Xu hướng accuracy (bấm chấm để mở ván)">
          {trend.length < 2 ? (
            <div className="text-sm text-muted">Cần ít nhất 2 ván đã phân tích.</div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer>
                <LineChart data={trend} margin={{ left: -20, right: 8, top: 6 }}>
                  <CartesianGrid stroke="var(--color-line)" vertical={false} strokeDasharray="2 4" />
                  <XAxis dataKey="playedAt" tickFormatter={fmtDate} tick={axis} minTickGap={24} />
                  <YAxis domain={[0, 100]} tick={axis} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => new Date(Number(v)).toLocaleDateString('vi-VN')} formatter={(v) => [`${v}%`, 'Accuracy']} />
                  <Line
                    dataKey="accuracy"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: 'var(--color-accent)', strokeWidth: 0 }}
                    activeDot={{ r: 6, onClick: (_e: unknown, p: unknown) => openGame((p as { payload: { gameId: number } }).payload.gameId) }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title={`Rating theo thời gian (${speed === 'all' ? mostCommonSpeed(stats) ?? '' : speed})`}>
          {ratingTrend.length < 2 ? (
            <div className="text-sm text-muted">Chưa đủ dữ liệu rating trong các ván đã tải.</div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer>
                <LineChart data={ratingTrend} margin={{ left: -10, right: 8, top: 6 }}>
                  <CartesianGrid stroke="var(--color-line)" vertical={false} strokeDasharray="2 4" />
                  <XAxis dataKey="playedAt" tickFormatter={fmtDate} tick={axis} minTickGap={24} />
                  <YAxis domain={['dataMin - 30', 'dataMax + 30']} tick={axis} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => new Date(Number(v)).toLocaleDateString('vi-VN')} formatter={(v) => [v, 'Rating']} />
                  <Line dataKey="rating" stroke="var(--color-fg)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Khai cuộc thua nhiều nhất">
          <div className="mb-2 flex gap-2">
            <Button variant={color === 'w' ? 'primary' : 'default'} onClick={() => setColor('w')}>
              Cầm Trắng
            </Button>
            <Button variant={color === 'b' ? 'primary' : 'default'} onClick={() => setColor('b')}>
              Cầm Đen
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-muted">
              <tr>
                <th className="text-left font-normal">Khai cuộc</th>
                <th className="font-normal">Ván</th>
                <th className="w-40 font-normal">Thắng · Hòa · Thua</th>
                <th className="font-normal">Acc.</th>
              </tr>
            </thead>
            <tbody>
              {openings.map((o) => (
                <tr key={o.family} className="border-t border-line">
                  <td className="py-1">{o.family}</td>
                  <td className="text-center">{o.games}</td>
                  <td>
                    <WdlBar w={o.win} d={o.draw} l={o.loss} />
                  </td>
                  <td className="text-center text-muted">{o.avgAccuracy?.toFixed(0) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Theo giai đoạn (nước của bạn)">
          <div className="h-44">
            <ResponsiveContainer>
              <BarChart data={stats.phases.map((p) => ({ ...p, name: PHASE_VI[p.phase], acc: p.accuracy ? Math.round(p.accuracy) : 0 }))} margin={{ left: -20, top: 6 }}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} strokeDasharray="2 4" />
                <XAxis dataKey="name" tick={axis} />
                <YAxis domain={[0, 100]} tick={axis} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--color-panel-2)' }} formatter={(v) => [`${v}%`, 'Accuracy']} />
                <Bar dataKey="acc" fill="var(--color-accent)" radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {stats.phases.map((p) => (
                <tr key={p.phase} className="border-t border-line">
                  <td className="py-1">{PHASE_VI[p.phase]}</td>
                  <td className="text-muted">{p.moves} nước</td>
                  <td>{p.errorsPerGame.toFixed(2)} lỗi/ván</td>
                  <td className="text-danger">{p.blundersPerGame.toFixed(2)} blunder/ván</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-xs text-muted">
            Giai đoạn theo vật chất: trung cuộc khi còn ≤ 10 quân nhẹ+nặng (hoặc hàng cuối một bên còn &lt; 4 quân), tàn cuộc khi ≤ 6.
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Sai lầm theo thời gian còn lại">
          {stats.clock.length === 0 ? (
            <div className="text-sm text-muted">PGN chưa có dữ liệu đồng hồ (%clk).</div>
          ) : (
            <>
              <div className="h-40">
                <ResponsiveContainer>
                  <BarChart data={stats.clock.map((c) => ({ ...c, rate: c.moves ? Math.round((c.blunders / c.moves) * 1000) / 10 : 0 }))} margin={{ left: -20, top: 6 }}>
                    <CartesianGrid stroke="var(--color-line)" vertical={false} strokeDasharray="2 4" />
                    <XAxis dataKey="bucket" tick={{ ...axis, fontSize: 9 }} interval={0} />
                    <YAxis tick={axis} unit="%" />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--color-panel-2)' }} formatter={(v) => [`${v}%`, 'Tỷ lệ blunder']} />
                    <Bar dataKey="rate" fill="var(--color-danger)" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="text-xs text-muted">Tỷ lệ blunder trên số nước, theo thời gian còn lại khi đi.</div>
            </>
          )}
        </Card>
        <Card title="Motif hay bỏ lỡ">
          <MotifTable rows={stats.motifsMissed} />
        </Card>
        <Card title="Motif hay dính">
          <MotifTable rows={stats.motifsSuffered} />
        </Card>
      </div>

      <Card title="Phân loại nước đi của bạn">
        <div className="flex flex-wrap gap-4 text-sm">
          {CLASSIFICATIONS.map((c) => (
            <div key={c}>
              <span style={{ color: CLASS_INFO[c].color }} className="font-semibold">
                {CLASS_INFO[c].symbol}
              </span>{' '}
              {CLASS_INFO[c].vi}: <b>{stats.classCounts[c] ?? 0}</b>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Nhận xét tổng quan (Gemini)">
        <Explanation req={{ kind: 'overview' }} auto={false} label="Nhận xét tổng quan & gợi ý luyện tập" />
      </Card>
    </div>
  )
}

function mostCommonSpeed(stats: Stats | null): Speed | null {
  const c = new Map<Speed, number>()
  for (const t of stats?.ratingTrend ?? []) if (t.speed) c.set(t.speed, (c.get(t.speed) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

function WdlBar({ w, d, l }: { w: number; d: number; l: number }) {
  const t = w + d + l || 1
  return (
    <div className="flex items-center gap-2" title={`Thắng ${w} · Hòa ${d} · Thua ${l}`}>
      <div className="flex h-2.5 flex-1 gap-[2px] overflow-hidden rounded">
        {w > 0 && <div className="bg-accent" style={{ width: `${(w / t) * 100}%` }} />}
        {d > 0 && <div className="bg-muted/60" style={{ width: `${(d / t) * 100}%` }} />}
        {l > 0 && <div className="bg-danger" style={{ width: `${(l / t) * 100}%` }} />}
      </div>
      <span className="w-14 text-right text-xs text-muted">
        {w}·{d}·{l}
      </span>
    </div>
  )
}

function MotifTable({ rows }: { rows: { kind: string; count: number }[] }) {
  if (rows.length === 0) return <div className="text-sm text-muted">Chưa có dữ liệu (cần ván đã phân tích có lỗi).</div>
  const max = rows[0]!.count
  return (
    <div className="space-y-1.5 text-sm">
      {rows.slice(0, 8).map((r) => (
        <div key={r.kind}>
          <div className="flex justify-between">
            <span>{MOTIF_VI[r.kind as MotifKind] ?? r.kind}</span>
            <b>{r.count}</b>
          </div>
          <div className="h-1.5 rounded bg-panel-2">
            <div className="h-full rounded bg-warn" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
