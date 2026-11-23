import { useCallback, useEffect, useState } from 'react'
import type { FetchProgress, GameFilter, GameRow, Speed, UserResult } from '@shared/types'
import { useApp } from '../store'
import { Button, Input, Notice } from '../components/ui'

const PAGE = 50
const SPEEDS: Speed[] = ['bullet', 'blitz', 'rapid', 'classical', 'daily']
const SPEED_VI: Record<Speed, string> = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', daily: 'Daily' }

export default function Library() {
  const { openGame, settings, notify } = useApp()
  const [filter, setFilter] = useState<GameFilter>({ page: 0, pageSize: PAGE })
  const [data, setData] = useState<{ rows: GameRow[]; total: number } | null>(null)
  const [showImport, setShowImport] = useState(false)

  const load = useCallback(() => void window.api.listGames(filter).then(setData), [filter])
  useEffect(load, [load])
  useEffect(() => window.api.onGamesChanged(load), [load])

  const set = (patch: Partial<GameFilter>) => setFilter((f) => ({ ...f, ...patch, page: 0 }))
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1

  return (
    <div className="flex h-full flex-col gap-3 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Thư viện ván</h1>
        <span className="text-muted">{data?.total ?? 0} ván</span>
        <Button className="ml-auto" variant="primary" onClick={() => setShowImport((v) => !v)}>
          {showImport ? 'Đóng' : '+ Nhập ván'}
        </Button>
      </div>

      {showImport && (
        <ImportPanel username={settings?.chesscomUsername ?? ''} lichess={settings?.lichessUsername ?? ''} maxGames={settings?.maxGames ?? 0} notify={notify} />
      )}

      <div className="flex flex-wrap gap-2">
        <Input className="!w-48" placeholder="Đối thủ / người chơi" onChange={(e) => set({ text: e.target.value || undefined })} />
        <Input className="!w-48" placeholder="Khai cuộc / ECO" onChange={(e) => set({ opening: e.target.value || undefined })} />
        <Select value={filter.result ?? ''} onChange={(v) => set({ result: (v || undefined) as UserResult | undefined })}>
          <option value="">Mọi kết quả</option>
          <option value="win">Thắng</option>
          <option value="draw">Hòa</option>
          <option value="loss">Thua</option>
        </Select>
        <Select value={filter.color ?? ''} onChange={(v) => set({ color: (v || undefined) as 'w' | 'b' | undefined })}>
          <option value="">Cả 2 màu</option>
          <option value="w">Tôi cầm Trắng</option>
          <option value="b">Tôi cầm Đen</option>
        </Select>
        <Select value={filter.speed ?? ''} onChange={(v) => set({ speed: (v || undefined) as Speed | undefined })}>
          <option value="">Mọi thể loại</option>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {SPEED_VI[s]}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1 text-sm text-muted">
          Từ
          <input type="date" className="rounded border border-line bg-panel-2 px-2 py-1" onChange={(e) => set({ from: e.target.value ? Date.parse(e.target.value) : undefined })} />
        </label>
        <label className="flex items-center gap-1 text-sm text-muted">
          đến
          <input
            type="date"
            className="rounded border border-line bg-panel-2 px-2 py-1"
            onChange={(e) => set({ to: e.target.value ? Date.parse(e.target.value) + 86_399_999 : undefined })}
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-panel">
        {!data ? (
          <div className="p-6 text-muted">Đang tải...</div>
        ) : data.rows.length === 0 ? (
          <div className="p-8 text-center text-muted">
            Chưa có ván nào. Bấm "+ Nhập ván" để dán PGN, mở file hoặc tải ván từ Chess.com / Lichess.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel-2 text-left text-muted">
              <tr>
                <th className="px-3 py-2 font-normal">Ngày</th>
                <th className="px-3 py-2 font-normal">Trắng</th>
                <th className="px-3 py-2 font-normal">Đen</th>
                <th className="px-3 py-2 font-normal">Kết quả</th>
                <th className="px-3 py-2 font-normal">Thể loại</th>
                <th className="px-3 py-2 font-normal">Khai cuộc</th>
                <th className="px-3 py-2 font-normal">Accuracy</th>
                <th className="px-3 py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((g) => (
                <tr key={g.id} className="cursor-pointer border-t border-line hover:bg-panel-2" onClick={() => openGame(g.id)}>
                  <td className="px-3 py-1.5 whitespace-nowrap text-muted">{g.playedAt ? new Date(g.playedAt).toLocaleDateString('vi-VN') : '—'}</td>
                  <td className={`px-3 py-1.5 ${g.userColor === 'w' ? 'font-semibold' : ''}`}>
                    {g.white} <span className="text-muted">{g.whiteElo ?? ''}</span>
                  </td>
                  <td className={`px-3 py-1.5 ${g.userColor === 'b' ? 'font-semibold' : ''}`}>
                    {g.black} <span className="text-muted">{g.blackElo ?? ''}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    <ResultBadge g={g} />
                  </td>
                  <td className="px-3 py-1.5 text-muted">{g.speed ? SPEED_VI[g.speed] : '—'}</td>
                  <td className="max-w-64 truncate px-3 py-1.5" title={g.openingName ?? ''}>
                    {g.openingName ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <Accuracy g={g} />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      className="text-muted hover:text-danger"
                      title="Xóa ván"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`Xóa ván ${g.white} - ${g.black}?`)) void window.api.deleteGame(g.id)
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button disabled={!filter.page} onClick={() => setFilter((f) => ({ ...f, page: (f.page ?? 0) - 1 }))}>
            ◀
          </Button>
          <span>
            Trang {(filter.page ?? 0) + 1}/{pages}
          </span>
          <Button disabled={(filter.page ?? 0) + 1 >= pages} onClick={() => setFilter((f) => ({ ...f, page: (f.page ?? 0) + 1 }))}>
            ▶
          </Button>
        </div>
      )}
    </div>
  )
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select className="rounded border border-line bg-panel-2 px-2 py-1.5 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  )
}

function ResultBadge({ g }: { g: GameRow }) {
  const c = g.userResult === 'win' ? 'bg-accent/25 text-accent' : g.userResult === 'loss' ? 'bg-danger/20 text-danger' : 'bg-panel-2 text-muted'
  return <span className={`rounded px-2 py-0.5 font-mono text-xs ${c}`}>{g.result}</span>
}

function Accuracy({ g }: { g: GameRow }) {
  if (g.analysisStatus === 'none') return <span className="text-xs text-muted">chưa phân tích</span>
  const mine = g.userColor === 'b' ? g.blackAccuracy : g.userColor === 'w' ? g.whiteAccuracy : null
  return (
    <span>
      {mine !== null ? <b>{mine.toFixed(1)}%</b> : `${g.whiteAccuracy?.toFixed(0)} / ${g.blackAccuracy?.toFixed(0)}`}
      {g.analysisStatus === 'quick' && <span className="ml-1 text-xs text-muted">(nhanh)</span>}
    </span>
  )
}

function ImportPanel({
  username,
  lichess,
  maxGames,
  notify
}: {
  username: string
  lichess: string
  maxGames: number
  notify: (t: string, k?: 'ok' | 'error' | 'info') => void
}) {
  const [pgn, setPgn] = useState('')
  const [site, setSite] = useState<'chesscom' | 'lichess'>('chesscom')
  const [user, setUser] = useState(username)
  const [max, setMax] = useState(maxGames > 0 ? maxGames : 50)
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [speeds, setSpeeds] = useState<Speed[]>([])
  const [color, setColor] = useState<'' | 'w' | 'b'>('')
  const [progress, setProgress] = useState<FetchProgress | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => window.api.onFetchProgress(setProgress), [])
  useEffect(() => setUser(site === 'chesscom' ? username : lichess), [site, username, lichess])

  const report = (r: { added: number; skipped: number; errors: string[] } | null) => {
    if (!r) return
    notify(`Đã thêm ${r.added} ván${r.skipped ? `, bỏ qua ${r.skipped} ván trùng` : ''}${r.errors.length ? `, ${r.errors.length} lỗi` : ''}`, r.errors.length ? 'error' : 'ok')
  }

  const fetchGames = async () => {
    setBusy(true)
    try {
      report(
        await window.api.fetchGames({
          site,
          username: user,
          max,
          since: since ? Date.parse(since) : undefined,
          until: until ? Date.parse(until) + 86_399_999 : undefined,
          speeds: speeds.length ? speeds : undefined,
          color: color || undefined
        })
      )
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
  }

  return (
    <div className="grid grid-cols-2 gap-4 rounded-lg border border-line bg-panel p-4">
      <div className="space-y-2">
        <div className="font-semibold">Dán PGN hoặc mở file</div>
        <textarea
          className="h-36 w-full rounded border border-line bg-panel-2 p-2 font-mono text-xs"
          placeholder="Dán một hoặc nhiều ván PGN..."
          value={pgn}
          onChange={(e) => setPgn(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={!pgn.trim()}
            onClick={() =>
              void window.api.importPgn(pgn).then((r) => {
                report(r)
                if (r.added) setPgn('')
              })
            }
          >
            Nhập PGN
          </Button>
          <Button onClick={() => void window.api.openPgnFile().then(report)}>Mở file .pgn...</Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="font-semibold">Tải ván theo tài khoản</div>
        <div className="flex gap-2">
          <select className="rounded border border-line bg-panel-2 px-2" value={site} onChange={(e) => setSite(e.target.value as 'chesscom' | 'lichess')}>
            <option value="chesscom">Chess.com</option>
            <option value="lichess">Lichess</option>
          </select>
          <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="username" />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">
            Tối đa
            <input type="number" min={1} max={500} className="w-20 rounded border border-line bg-panel-2 px-2 py-1" value={max} onChange={(e) => setMax(Number(e.target.value) || 1)} />
            ván
          </label>
          <label className="flex items-center gap-1">
            từ <input type="date" className="rounded border border-line bg-panel-2 px-1 py-1" value={since} onChange={(e) => setSince(e.target.value)} />
          </label>
          <label className="flex items-center gap-1">
            đến <input type="date" className="rounded border border-line bg-panel-2 px-1 py-1" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {SPEEDS.filter((s) => site === 'lichess' || s !== 'classical').map((s) => (
            <label key={s} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={speeds.includes(s)}
                onChange={(e) => setSpeeds((l) => (e.target.checked ? [...l, s] : l.filter((x) => x !== s)))}
              />
              {SPEED_VI[s]}
            </label>
          ))}
          <select className="rounded border border-line bg-panel-2 px-2 py-1" value={color} onChange={(e) => setColor(e.target.value as '' | 'w' | 'b')}>
            <option value="">Cả 2 màu</option>
            <option value="w">Trắng</option>
            <option value="b">Đen</option>
          </select>
        </div>
        <Button variant="primary" disabled={busy || !user.trim()} onClick={() => void fetchGames()}>
          {busy ? 'Đang tải...' : 'Tải ván mới'}
        </Button>
        {progress && <Notice kind={progress.message.startsWith('Lỗi') ? 'error' : 'info'}>{progress.message}</Notice>}
        {maxGames > 0 && (
          <div className="text-xs text-warn">App đang chỉ giữ {maxGames} ván mới nhất (đổi trong Cài đặt → Dung lượng). Ván cũ hơn sẽ tự bị xóa.</div>
        )}
        <div className="text-xs text-muted">Chỉ tải ván chưa có. Ván mới sẽ tự được quét nhanh ở chế độ nền (nếu bật trong Cài đặt).</div>
      </div>
    </div>
  )
}
