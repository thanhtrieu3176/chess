/**
 * Màn hình làm việc với bàn cờ, dùng chung cho:
 *  - "Phân tích": xem một ván đã lưu (phân tích 2 lượt, phân loại nước, biểu đồ, giải thích).
 *  - "Sandbox": thử biến tự do từ bất kỳ vị trí nào với engine phân tích vô hạn.
 * Nước đi thử luôn được lưu thành nhánh phụ trong cây, không ghi đè ván gốc.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DrawShape } from 'chessground/draw'
import type {
  AnalysisResult,
  EngineLine,
  GameAnalysis,
  GameDetail,
  LiveUpdate,
  Motif,
  MoveAnalysis,
  Opening,
  Score,
  TablebaseResult
} from '@shared/types'
import { CLASS_INFO, CLASSIFICATIONS, KEY_MOMENTS } from '@shared/analysis/classify'
import { formatScore } from '@shared/analysis/winPercent'
import { bestMoveInfo, type BestMoveInfo } from '@shared/analysis/bestMove'
import { fromFen, isValidFen, playUci } from '@shared/chess/position'
import { START_FEN } from '@shared/fen'
import { MoveTree, type TreeNode } from '@shared/tree'
import { useApp } from '../store'
import { arrow, badge, Board, circle } from '../components/Board'
import { EvalBar } from '../components/EvalBar'
import { MoveList } from '../components/MoveList'
import { EngineLines } from '../components/EngineLines'
import { EvalChart } from '../components/EvalChart'
import { Explanation } from '../components/Explanation'
import { MotifList } from '../components/Motifs'
import { Button, Input, Notice } from '../components/ui'
import { playMoveSound } from '../lib/sound'

type Tab = 'analysis' | 'summary' | 'opening' | 'tools'

export default function Workspace({ mode }: { mode: 'game' | 'sandbox' }) {
  const { settings, gameId, sandboxFen, engine, notify, openSandbox } = useApp()
  const multiPv = settings?.multiPv ?? 3

  const [detail, setDetail] = useState<GameDetail | null>(null)
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null)
  const [tree, setTree] = useState(() => new MoveTree(START_FEN))
  const [version, setVersion] = useState(0)
  const [current, setCurrent] = useState<TreeNode>(() => tree.root)
  const [orientation, setOrientation] = useState<'white' | 'black'>('white')
  const [engineOn, setEngineOn] = useState(mode === 'sandbox')
  const [live, setLive] = useState<LiveUpdate | null>(null)
  const [quick, setQuick] = useState<Record<string, AnalysisResult>>({})
  const [hover, setHover] = useState<string[] | null>(null)
  /** Đã bấm nút "Nước đi tốt nhất" cho nước đang xem chưa. */
  const [showBest, setShowBest] = useState(false)
  const [posMotifs, setPosMotifs] = useState<Motif[]>([])
  const [tb, setTb] = useState<TablebaseResult | null>(null)
  const [tab, setTab] = useState<Tab>('analysis')
  const [loadError, setLoadError] = useState<string | null>(null)
  const fenRef = useRef(current.fen)
  fenRef.current = current.fen
  const bump = () => setVersion((v) => v + 1)

  // ---- Nạp ván (chế độ Phân tích) hoặc vị trí (Sandbox)
  useEffect(() => {
    if (mode !== 'game') return
    if (gameId === null) return
    let alive = true
    setLoadError(null)
    void window.api.getGame(gameId).then((d) => {
      if (!alive) return
      if (!d) {
        setLoadError('Không tìm thấy ván')
        return
      }
      const t = MoveTree.fromMainline(d.startFen, d.moves)
      setDetail(d)
      setAnalysis(d.analysis)
      setTree(t)
      setCurrent(t.root)
      setOrientation(d.row.userColor === 'b' ? 'black' : 'white')
      bump()
      // Tự phân tích khi mở ván chưa phân tích, hoặc mới quét nhanh (lượt 2 rất nhanh nhờ cache).
      if (!d.analysis || d.analysis.status === 'quick') void window.api.analyzeGame(gameId)
    })
    return () => {
      alive = false
    }
  }, [mode, gameId])

  useEffect(() => {
    if (mode !== 'sandbox') return
    const t = new MoveTree(sandboxFen && isValidFen(sandboxFen) ? sandboxFen : START_FEN)
    setTree(t)
    setCurrent(t.root)
    setOrientation(fromFen(t.root.fen).turn)
    bump()
  }, [mode, sandboxFen])

  useEffect(
    () =>
      window.api.onAnalysisUpdate(({ gameId: id, analysis: a }) => {
        if (mode === 'game' && id === gameId) setAnalysis(a)
      }),
    [mode, gameId]
  )

  // ---- Engine trực tiếp
  useEffect(
    () =>
      window.api.onLiveUpdate((u) => {
        if (u.fen === fenRef.current) setLive(u)
      }),
    []
  )
  useEffect(() => {
    setLive(null)
    if (!engineOn || !engine?.ready) {
      void window.api.stopLive()
      return
    }
    if (fromFen(current.fen).isEnd()) return
    void window.api.startLive(current.fen, multiPv).catch(() => undefined)
  }, [engineOn, current.fen, multiPv, engine?.ready])
  useEffect(() => () => void window.api.stopLive(), [])

  // ---- Thông tin theo vị trí hiện tại
  const gameMove = useMemo(() => {
    if (mode !== 'game' || !detail || current.ply === 0 || !tree.isMainline(current)) return null
    return current.ply <= detail.moves.length ? current.ply : null
  }, [mode, detail, current, tree, version])
  const onMainline = mode === 'game' && tree.isMainline(current)
  const stored = onMainline && analysis ? (analysis.positions[current.ply] ?? null) : null
  const ma: MoveAnalysis | null = gameMove && analysis ? (analysis.moves[gameMove - 1] ?? null) : null
  const best: BestMoveInfo | null = useMemo(() => {
    if (!ma || !gameMove || !detail || !analysis) return null
    try {
      return bestMoveInfo(detail.moves[gameMove - 1]!.fenBefore, current.uci, ma, analysis.positions[gameMove - 1] ?? null)
    } catch {
      return null
    }
  }, [ma, gameMove, detail, analysis, current.uci])
  useEffect(() => setShowBest(false), [current])

  // Vị trí chưa có đánh giá: đẩy lên đầu hàng đợi, hoặc phân tích nhanh riêng (đánh giá sơ bộ < 0,5s).
  useEffect(() => {
    if (engineOn || !engine?.ready || stored || quick[current.fen] || fromFen(current.fen).isEnd()) return
    if (onMainline && analysis?.status === 'running') {
      void window.api.promotePosition(current.fen)
      return
    }
    const fen = current.fen
    void window.api
      .analyze(fen, { movetime: 400 }, multiPv, 'interactive')
      .then((r) => setQuick((q) => ({ ...q, [fen]: r })))
      .catch(() => undefined)
  }, [current.fen, engineOn, engine?.ready, stored, onMainline, analysis?.status])

  useEffect(() => {
    const prev = current.parent
    void window.api.positionMotifs(current.fen, prev ? current.uci : undefined, prev?.fen).then(setPosMotifs)
    setTb(null)
    const pieces = current.fen.split(' ')[0]!.replace(/[^a-zA-Z]/g, '').length
    if (pieces <= 7) void window.api.tablebase(current.fen).then(setTb)
  }, [current])

  const view: { lines: EngineLine[]; depth: number; score: Score | null } = useMemo(() => {
    if (engineOn && live && live.fen === current.fen) return { lines: live.lines, depth: live.depth, score: live.lines[0]?.score ?? null }
    if (stored) return { lines: stored.lines, depth: stored.depth, score: stored.score }
    const q = quick[current.fen]
    if (q) return { lines: q.lines, depth: q.depth, score: q.lines[0]?.score ?? null }
    return { lines: [], depth: 0, score: null }
  }, [engineOn, live, stored, quick, current.fen])

  const pos = useMemo(() => fromFen(current.fen), [current.fen])
  const terminalScore: Score | null = pos.isCheckmate() ? { cp: pos.turn === 'white' ? -100000 : 100000 } : pos.isEnd() ? { cp: 0 } : null

  // ---- Mũi tên & ký hiệu trên bàn cờ
  const shapes = useMemo(() => {
    const out: DrawShape[] = []
    const bad = ma && ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(ma.classification)
    if (ma && showBest && best) {
      // Đã bấm "Nước đi tốt nhất": mũi tên xanh = nước tốt nhất, đỏ/vàng = nước đã đi (nếu kém).
      if (bad) out.push(arrow(current.uci, ma.classification === 'inaccuracy' ? 'yellow' : 'red'))
      out.push(arrow(best.uci, 'green'))
    } else if (ma && bad) {
      out.push(arrow(current.uci, ma.classification === 'inaccuracy' ? 'yellow' : 'red'))
    } else {
      view.lines.slice(0, engineOn ? 3 : 1).forEach((l, i) => {
        if (l.pv[0]) out.push(arrow(l.pv[0], i === 0 ? 'green' : 'paleGreen', i === 0 ? undefined : 7))
      })
    }
    if (ma) {
      const c = CLASS_INFO[ma.classification]
      out.push(badge(current.uci.slice(2, 4), c.symbol, c.color))
    }
    if (hover) hover.forEach((sq) => out.push(circle(sq, 'yellow')))
    return out
  }, [ma, current, view.lines, engineOn, hover, showBest, best])

  // ---- Điều hướng
  const select = useCallback((n: TreeNode, sound = false) => {
    setCurrent(n)
    setHover(null)
    if (sound && n.san) playMoveSound(n.san)
  }, [])
  const goto = useCallback(
    (ply: number) => {
      const main = tree.mainline()
      select(ply === 0 ? tree.root : (main[ply - 1] ?? tree.root))
    },
    [tree, select]
  )

  const onMove = useCallback(
    (uci: string) => {
      const n = tree.addMove(current, uci)
      if (!n) return
      bump()
      select(n, true)
    },
    [tree, current, select]
  )

  /** Đưa biến engine vào cây (nhánh phụ) tới nước thứ `upto`, rồi đi tới đó. */
  const playLine = useCallback(
    (pv: string[], upto: number) => {
      let n: TreeNode | null = current
      for (const uci of pv.slice(0, upto + 1)) {
        n = n && tree.addMove(n, uci)
      }
      if (n) {
        bump()
        select(n, true)
      }
    },
    [tree, current, select]
  )

  /** Đi thử biến của nước tốt nhất: từ vị trí TRƯỚC nước đã đi, lưu thành nhánh phụ. */
  const tryBestLine = useCallback(
    (pv: string[]) => {
      const parent = current.parent
      if (!parent) return
      let n: TreeNode | null = parent
      for (const uci of pv) n = n && tree.addMove(n, uci)
      const first = parent.children.find((c) => c.uci === pv[0])
      if (first) {
        bump()
        select(first, true)
      }
    },
    [tree, current, select]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      if (e.key === 'ArrowLeft' && current.parent) select(current.parent)
      else if (e.key === 'ArrowRight' && current.children[0]) select(current.children[0], true)
      else if (e.key === 'ArrowUp') select(tree.root)
      else if (e.key === 'ArrowDown') {
        let n = current
        while (n.children[0]) n = n.children[0]
        select(n)
      } else if (e.key === 'f' || e.key === 'F') setOrientation((o) => (o === 'white' ? 'black' : 'white'))
      else if (e.key === ' ') setEngineOn((v) => !v)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, tree, select])

  const classOf = useCallback(
    (n: TreeNode) => (mode === 'game' && analysis && tree.isMainline(n) && n.ply > 0 ? analysis.moves[n.ply - 1]?.classification : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, analysis, tree, version]
  )

  if (mode === 'game' && gameId === null)
    return <Empty text="Chưa mở ván nào. Vào Thư viện ván để chọn một ván, hoặc dán PGN." />
  if (loadError) return <Empty text={loadError} />
  if (mode === 'game' && !detail) return <Empty text="Đang tải ván..." />

  const evalScore = terminalScore ?? view.score
  const clock = gameMove ? detail?.moves[gameMove - 1]?.clockMs : undefined
  const running = analysis?.status === 'running'

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      {mode === 'game' && detail && <GameHeader detail={detail} analysis={analysis} />}
      {running && analysis && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted">
            {analysis.pass === 1 ? 'Quét nhanh' : 'Phân tích sâu nước quan trọng'}: {analysis.done}/{analysis.total}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded bg-panel-2">
            <div className="h-full bg-accent transition-all" style={{ width: `${(analysis.done / Math.max(1, analysis.total)) * 100}%` }} />
          </div>
          <Button onClick={() => void window.api.cancelAnalysis()}>Hủy</Button>
        </div>
      )}
      {analysis?.status === 'error' && <Notice kind="error">Phân tích lỗi: {analysis.error}</Notice>}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Bàn cờ + eval bar */}
        <div className="flex min-h-0 shrink-0 flex-col gap-2" style={{ width: 'min(62vh, 50vw)' }}>
          <div className="flex gap-2">
            <div className="flex">
              <EvalBar score={evalScore} orientation={orientation} />
            </div>
            <div className="min-w-0 flex-1">
              <Board fen={current.fen} orientation={orientation} lastMove={current.uci || null} onMove={onMove} shapes={shapes} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button onClick={() => select(tree.root)} title="Về đầu (↑)">⏮</Button>
            <Button onClick={() => current.parent && select(current.parent)} title="Lùi (←)">◀</Button>
            <Button onClick={() => current.children[0] && select(current.children[0], true)} title="Tiến (→)">▶</Button>
            <Button
              onClick={() => {
                let n = current
                while (n.children[0]) n = n.children[0]
                select(n)
              }}
              title="Về cuối (↓)"
            >
              ⏭
            </Button>
            <Button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} title="Lật bàn (F)">⇅</Button>
            <Button variant={engineOn ? 'primary' : 'default'} onClick={() => setEngineOn((v) => !v)} title="Bật/tắt engine (Space)" disabled={!engine?.ready}>
              {engineOn ? '■ Engine' : '▶ Engine'}
            </Button>
            <span className="ml-auto font-mono text-muted">{formatScore(evalScore)}</span>
            {clock !== undefined && <span className="text-muted">⏱ {fmtClock(clock)}</span>}
          </div>
          {tb && tb.category !== 'unknown' && (
            <Notice kind="info">
              Tablebase: {tbLabel(tb, pos.turn)}
              {tb.bestSan ? ` — nước tốt nhất ${tb.bestSan}` : ''}
            </Notice>
          )}
        </div>

        {/* Panel phải */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-line bg-panel">
          <div className="flex border-b border-line text-sm">
            {(
              [
                ['analysis', 'Phân tích'],
                ...(mode === 'game' ? [['summary', 'Tổng kết']] : []),
                ['opening', 'Khai cuộc'],
                ['tools', 'Công cụ']
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-4 py-2 ${tab === id ? 'border-b-2 border-accent font-semibold' : 'text-muted hover:text-fg'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {tab === 'analysis' && (
              <div className="space-y-4">
                <section>
                  <div className="mb-1 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
                    Biến của engine {engineOn ? '(trực tiếp)' : ''}
                  </div>
                  {pos.isEnd() ? (
                    <div className="text-sm text-muted">{pos.isCheckmate() ? 'Chiếu hết.' : 'Ván hòa.'}</div>
                  ) : (
                    <EngineLines fen={current.fen} lines={view.lines} depth={view.depth} onPlay={playLine} />
                  )}
                </section>

                {ma && (
                  <section className="rounded border border-line p-2 text-sm">
                    <span className="font-semibold" style={{ color: CLASS_INFO[ma.classification].color }}>
                      {CLASS_INFO[ma.classification].symbol} {current.san} — {CLASS_INFO[ma.classification].vi}
                    </span>
                    <span className="text-muted">
                      {' '}
                      · Win% {ma.winBefore.toFixed(0)} → {ma.winAfter.toFixed(0)} · accuracy {ma.accuracy.toFixed(0)}
                    </span>
                    {best && (
                      <div className="mt-2">
                        <Button variant={showBest ? 'default' : 'primary'} onClick={() => setShowBest((v) => !v)}>
                          {showBest ? 'Ẩn nước đi tốt nhất' : '💡 Nước đi tốt nhất'}
                        </Button>
                      </div>
                    )}
                    {showBest && best && (
                      <BestMovePanel
                        info={best}
                        playedSan={current.san}
                        gameId={gameId!}
                        ply={gameMove!}
                        onHover={setHover}
                        onTry={() => tryBestLine(best.pv)}
                      />
                    )}
                  </section>
                )}

                <section className="max-h-72 overflow-auto rounded border border-line p-2">
                  <MoveList tree={tree} version={version} current={current} onSelect={select} classOf={classOf} />
                </section>

                {ma && (
                  <>
                    <MotifList title="Nước đi tạo ra" motifs={ma.motifs.played} onHover={setHover} />
                    <MotifList title="Cơ hội trong nước tốt nhất" motifs={ma.motifs.best} onHover={setHover} />
                    <MotifList title="Đe dọa sau nước đi" motifs={ma.motifs.threats} onHover={setHover} />
                  </>
                )}
                <MotifList title="Đặc điểm vị trí" motifs={posMotifs} onHover={setHover} />

                {mode === 'game' && gameMove && analysis?.moves[gameMove - 1] && (
                  <section>
                    <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Giải thích (Gemini)</div>
                    <Explanation
                      req={{ kind: 'move', gameId: gameId!, ply: gameMove }}
                      auto={!!settings?.geminiAutoExplain && !!ma && KEY_MOMENTS.includes(ma.classification) && analysis.status !== 'running'}
                    />
                  </section>
                )}
              </div>
            )}

            {tab === 'summary' && detail && <Summary detail={detail} analysis={analysis} onPly={goto} gameId={gameId!} />}

            {tab === 'opening' && (
              <OpeningPanel
                tree={tree}
                current={current}
                detail={detail}
                onPlay={(uci) => onMove(uci)}
                version={version}
              />
            )}

            {tab === 'tools' && (
              <Tools
                tree={tree}
                current={current}
                detail={detail}
                onTreeChange={(t, n) => {
                  setTree(t)
                  setCurrent(n)
                  bump()
                }}
                onSelect={select}
                bump={bump}
                notify={notify}
                openSandbox={() => openSandbox(current.fen)}
                mode={mode}
              />
            )}
          </div>
        </div>
      </div>

      {mode === 'game' && analysis && (
        <div className="h-28 shrink-0 rounded-lg border border-line bg-panel p-1">
          <EvalChart analysis={analysis} ply={onMainline ? current.ply : -1} onSelect={goto} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Empty({ text }: { text: string }) {
  return <div className="p-8 text-muted">{text}</div>
}

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

function tbLabel(tb: TablebaseResult, turn: 'white' | 'black'): string {
  if (tb.category === 'draw') return 'Hòa'
  const winner = (tb.category === 'win') === (turn === 'white') ? 'Trắng' : 'Đen'
  const n = tb.dtm ? ` sau ${Math.ceil(Math.abs(tb.dtm) / 2)} nước` : tb.dtz ? ` (DTZ ${Math.abs(tb.dtz)})` : ''
  return `${winner} thắng${n}`
}

function GameHeader({ detail, analysis }: { detail: GameDetail; analysis: GameAnalysis | null }) {
  const r = detail.row
  const acc = (v: number | null | undefined) => (v === null || v === undefined ? '' : ` · ${v.toFixed(1)}%`)
  const resultColor = r.userResult === 'win' ? 'text-accent' : r.userResult === 'loss' ? 'text-danger' : 'text-muted'
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <div className="text-lg font-semibold">
        ⚪ {r.white} {r.whiteElo ? `(${r.whiteElo})` : ''}
        <span className="text-sm font-normal text-muted">{acc(analysis?.accuracy.w ?? r.whiteAccuracy)}</span>
        <span className="mx-2 text-muted">vs</span>⚫ {r.black} {r.blackElo ? `(${r.blackElo})` : ''}
        <span className="text-sm font-normal text-muted">{acc(analysis?.accuracy.b ?? r.blackAccuracy)}</span>
      </div>
      <div className={`font-semibold ${resultColor}`}>{r.result}</div>
      <div className="text-sm text-muted">
        {r.playedAt ? new Date(r.playedAt).toLocaleDateString('vi-VN') : ''} {r.speed ? `· ${r.speed}` : ''} {r.openingName ? `· ${r.openingName}` : ''}
      </div>
      {detail.repertoire && <Notice kind="info">📘 {detail.repertoire.message}</Notice>}
    </div>
  )
}

function Summary({ detail, analysis, onPly, gameId }: { detail: GameDetail; analysis: GameAnalysis | null; onPly: (p: number) => void; gameId: number }) {
  const counts = useMemo(() => {
    const c = { w: {} as Record<string, number>, b: {} as Record<string, number> }
    for (const m of analysis?.moves ?? []) if (m) c[m.color][m.classification] = (c[m.color][m.classification] ?? 0) + 1
    return c
  }, [analysis])
  if (!analysis) return <div className="text-muted">Chưa có kết quả phân tích.</div>
  return (
    <div className="space-y-4 text-sm">
      <table className="w-full">
        <thead>
          <tr className="text-muted">
            <th className="text-left font-normal" />
            <th className="font-normal">⚪ {detail.row.white}</th>
            <th className="font-normal">⚫ {detail.row.black}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="text-base font-semibold">
            <td>Accuracy</td>
            <td className="text-center">{analysis.accuracy.w?.toFixed(1) ?? '—'}%</td>
            <td className="text-center">{analysis.accuracy.b?.toFixed(1) ?? '—'}%</td>
          </tr>
          {CLASSIFICATIONS.map((c) => (
            <tr key={c}>
              <td style={{ color: CLASS_INFO[c].color }}>
                {CLASS_INFO[c].symbol} {CLASS_INFO[c].vi}
              </td>
              <td className="text-center">{counts.w[c] ?? 0}</td>
              <td className="text-center">{counts.b[c] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail.outOfBookPly && (
        <div className="text-muted">
          📖 Ra khỏi sách ở nước {Math.ceil(detail.outOfBookPly / 2)}
          {detail.outOfBookPly % 2 === 0 ? '...' : '.'} {detail.moves[detail.outOfBookPly - 1]?.san}
        </div>
      )}
      {detail.repertoire && <div>📘 {detail.repertoire.message}</div>}
      <div>
        <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Tóm tắt ván (Gemini)</div>
        {analysis.status === 'running' ? (
          <div className="text-muted">Chờ phân tích xong...</div>
        ) : (
          <Explanation req={{ kind: 'game', gameId }} auto={false} label="Tóm tắt cả ván" onPly={onPly} />
        )}
      </div>
    </div>
  )
}

function OpeningPanel({
  tree,
  current,
  detail,
  onPlay,
  version
}: {
  tree: MoveTree
  current: TreeNode
  detail: GameDetail | null
  onPlay: (uci: string) => void
  version: number
}) {
  const [opening, setOpening] = useState<{ o: Opening; fen: string } | null>(null)
  const [next, setNext] = useState<{ uci: string; san: string; opening: Opening; score?: Score }[]>([])

  useEffect(() => {
    const path = [tree.root, ...tree.path(current)]
    void window.api.openingAt(path.map((n) => n.fen)).then((os) => {
      for (let i = os.length - 1; i >= 0; i--) {
        if (os[i]) {
          setOpening({ o: os[i]!, fen: path[i]!.fen })
          return
        }
      }
      setOpening(null)
    })
    let alive = true
    void window.api.nextBookMoves(current.fen).then((moves) => {
      if (!alive) return
      setNext(moves)
      // Điểm engine từng nước (nhanh, ưu tiên cao).
      moves.forEach((m) => {
        const after = playUci(current.fen, m.uci)
        if (!after) return
        void window.api
          .analyze(after.fen, { movetime: 150 }, 1, 'interactive')
          .then((r) => {
            if (!alive) return
            setNext((list) => list.map((x) => (x.uci === m.uci ? { ...x, score: r.lines[0]?.score } : x)))
          })
          .catch(() => undefined)
      })
    })
    return () => {
      alive = false
    }
  }, [tree, current, version])

  const oob = detail?.outOfBookPly
  return (
    <div className="space-y-4 text-sm">
      {opening ? (
        <div>
          <div className="text-base font-semibold">{opening.o.name}</div>
          <div className="text-muted">
            ECO {opening.o.eco} · {opening.o.pgn}
          </div>
        </div>
      ) : (
        <div className="text-muted">Vị trí không có trong dữ liệu khai cuộc.</div>
      )}
      {oob && (
        <Notice kind="info">
          Ván ra khỏi sách ở nước {Math.ceil(oob / 2)}
          {oob % 2 === 0 ? '...' : '.'} {detail?.moves[oob - 1]?.san}
        </Notice>
      )}
      <div>
        <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Nước tiếp theo (lý thuyết)</div>
        {next.length === 0 ? (
          <div className="text-muted">Không còn nước lý thuyết từ vị trí này.</div>
        ) : (
          <table className="w-full">
            <tbody>
              {next.map((m) => (
                <tr key={m.uci} className="cursor-pointer hover:bg-panel-2" onClick={() => onPlay(m.uci)}>
                  <td className="w-16 py-0.5 font-semibold">{m.san}</td>
                  <td>{m.opening.name}</td>
                  <td className="w-16 text-right font-mono">{m.score ? formatScore(m.score) : '…'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {opening && (
        <div>
          <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Giải thích khai cuộc (Gemini)</div>
          <Explanation req={{ kind: 'opening', fen: opening.fen }} auto={false} label="Giải thích khai cuộc" />
        </div>
      )}
    </div>
  )
}

function Tools({
  tree,
  current,
  detail,
  onTreeChange,
  onSelect,
  bump,
  notify,
  openSandbox,
  mode
}: {
  tree: MoveTree
  current: TreeNode
  detail: GameDetail | null
  onTreeChange: (t: MoveTree, n: TreeNode) => void
  onSelect: (n: TreeNode) => void
  bump: () => void
  notify: (t: string, k?: 'ok' | 'error' | 'info') => void
  openSandbox: () => void
  mode: 'game' | 'sandbox'
}) {
  const [fen, setFen] = useState('')
  const [pgn, setPgn] = useState('')
  const [comment, setComment] = useState(current.comment)
  useEffect(() => setComment(current.comment), [current])

  const exportPgn = async () => {
    const headers: Record<string, string> = detail ? { ...detail.headers } : { Event: 'Sandbox' }
    delete headers.FEN
    delete headers.SetUp
    const ok = await window.api.savePgnFile(tree.toPgn(headers), `${detail ? `${detail.row.white}-${detail.row.black}` : 'sandbox'}.pgn`)
    if (ok) notify('Đã lưu PGN', 'ok')
  }

  return (
    <div className="space-y-5 text-sm">
      <section className="space-y-2">
        <div className="text-xs font-semibold tracking-wide text-muted uppercase">Nhánh hiện tại</div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!current.parent || tree.isMainline(current)}
            onClick={() => {
              tree.promote(current)
              bump()
            }}
          >
            Nâng thành biến chính
          </Button>
          <Button
            disabled={!current.parent || (mode === 'game' && tree.isMainline(current))}
            onClick={() => {
              const p = tree.delete(current)
              if (p) {
                bump()
                onSelect(p)
              }
            }}
          >
            Xóa nhánh từ nước này
          </Button>
          {mode === 'game' && <Button onClick={openSandbox}>Mở vị trí này trong Sandbox</Button>}
        </div>
        {mode === 'game' && <div className="text-xs text-muted">Biến chính của ván gốc không thể xóa; các biến bạn đi thử là nhánh phụ.</div>}
      </section>

      <section className="space-y-2">
        <div className="text-xs font-semibold tracking-wide text-muted uppercase">Chú thích cho nước {current.san || '(vị trí đầu)'}</div>
        <textarea
          className="h-20 w-full rounded border border-line bg-panel-2 p-2"
          value={comment}
          disabled={!current.parent}
          onChange={(e) => setComment(e.target.value)}
          onBlur={() => {
            current.comment = comment.trim()
            bump()
          }}
        />
      </section>

      <section className="space-y-2">
        <div className="text-xs font-semibold tracking-wide text-muted uppercase">Xuất / nhập</div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void exportPgn()}>Lưu PGN (có biến phụ & chú thích)</Button>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(current.fen)
              notify('Đã copy FEN', 'ok')
            }}
          >
            Copy FEN
          </Button>
        </div>
        {mode === 'sandbox' && (
          <>
            <div className="flex gap-2">
              <Input placeholder="Dán FEN để bắt đầu từ thế cờ bất kỳ" value={fen} onChange={(e) => setFen(e.target.value)} />
              <Button
                onClick={() => {
                  if (!isValidFen(fen)) return notify('FEN không hợp lệ', 'error')
                  const t = new MoveTree(fen.trim())
                  onTreeChange(t, t.root)
                }}
              >
                Mở FEN
              </Button>
            </div>
            <textarea
              className="h-24 w-full rounded border border-line bg-panel-2 p-2 font-mono text-xs"
              placeholder="Hoặc dán PGN (có thể có biến phụ)"
              value={pgn}
              onChange={(e) => setPgn(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  try {
                    const t = MoveTree.fromPgn(pgn)
                    onTreeChange(t, t.root)
                  } catch (e) {
                    notify(`PGN lỗi: ${e instanceof Error ? e.message : String(e)}`, 'error')
                  }
                }}
              >
                Mở PGN
              </Button>
              <Button
                onClick={() => {
                  const t = new MoveTree(START_FEN)
                  onTreeChange(t, t.root)
                }}
              >
                Bàn cờ mới
              </Button>
            </div>
          </>
        )}
      </section>
      <section className="text-xs text-muted">
        Phím tắt: ←/→ lùi/tiến · ↑/↓ về đầu/cuối · F lật bàn · Space bật/tắt engine. Kéo thả quân để đi thử (lưu thành nhánh phụ).
      </section>
    </div>
  )
}

/** Khung "Nước đi tốt nhất": nước, biến chính, lý do (tính bằng luật) và giải thích chi tiết bằng Gemini. */
function BestMovePanel({
  info,
  playedSan,
  gameId,
  ply,
  onHover,
  onTry
}: {
  info: BestMoveInfo
  playedSan: string
  gameId: number
  ply: number
  onHover: (sq: string[] | null) => void
  onTry: () => void
}) {
  const diff = info.winBest - info.winPlayed
  return (
    <div className="mt-2 space-y-2 rounded border border-accent/50 bg-accent/10 p-3">
      <div className="text-base font-semibold">
        {info.isPlayed ? (
          <>
            ✓ Bạn đã đi đúng nước tốt nhất: <span className="text-accent">{info.san}</span>
          </>
        ) : (
          <>
            Nước tốt nhất: <span className="text-accent">{info.san}</span>
            <span className="ml-2 text-sm font-normal text-muted">(bạn đã đi {playedSan})</span>
          </>
        )}
      </div>
      {!info.isPlayed && (
        <div className="text-sm">
          Tỷ lệ thắng của bạn: <b>{info.winBest.toFixed(0)}%</b> nếu đi {info.san}, so với <b>{info.winPlayed.toFixed(0)}%</b> sau {playedSan}
          {diff >= 1 ? ` — chênh ${diff.toFixed(0)} điểm.` : '.'}
        </div>
      )}
      <div className="text-sm">
        <span className="text-muted">Biến chính của engine: </span>
        <span className="font-mono">{info.line}</span>
        <button className="ml-2 text-accent hover:underline" onClick={onTry}>
          Đi thử trên bàn cờ →
        </button>
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Vì sao nước này tốt</div>
        {info.reasons.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {info.reasons.map((r, i) => (
              <li key={i} onMouseEnter={() => r.squares && onHover(r.squares)} onMouseLeave={() => onHover(null)}>
                {r.text}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-muted">
            Không có đòn chiến thuật rõ ràng: đây là nước giữ thế cờ tốt nhất theo engine. Xem biến chính để thấy kế hoạch, hoặc nhờ Gemini giải thích.
          </div>
        )}
      </div>
      <Explanation req={{ kind: 'best', gameId, ply }} auto={false} label="Giải thích chi tiết (Gemini)" />
    </div>
  )
}
