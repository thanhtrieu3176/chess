import { useEffect, useRef, useState } from 'react'
import { makeFen } from 'chessops/fen'
import { parsePgn, startingPosition } from 'chessops/pgn'
import { parseSan } from 'chessops/san'
import type { EngineLine, LiveUpdate, Score } from '@shared/types'
import { START_FEN } from '@shared/fen'
import { useApp } from '../store'
import { Button, Input, Notice } from '../components/ui'

/**
 * Màn hình tạm của giai đoạn 1: kiểm tra engine (phân tích trực tiếp + quét thử cả ván qua pool).
 * Bàn cờ và phân tích ván đầy đủ sẽ thay thế màn hình này ở giai đoạn 2–3.
 */

const SAMPLE_PGN =
  '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 8. f3 Be7 9. Qd2 O-O ' +
  '10. O-O-O Nbd7 11. g4 b5 12. g5 b4 13. Ne2 Ne8 14. f4 a5 15. f5 a4 16. Nbd4 exd4 17. Nxd4 b3 ' +
  '18. Kb1 bxc2+ 19. Nxc2 Bb3 20. axb3 axb3 21. Na3 Nc5'

function gameFens(pgn: string): string[] {
  const game = parsePgn(pgn)[0]
  if (!game) return []
  const pos = startingPosition(game.headers).unwrap()
  const fens = [makeFen(pos.toSetup())]
  for (const node of game.moves.mainline()) {
    const move = parseSan(pos, node.san)
    if (!move) break
    pos.play(move)
    fens.push(makeFen(pos.toSetup()))
  }
  return fens
}

export function formatScore(s: Score): string {
  if (s.mate !== undefined) return `#${s.mate}`
  const v = (s.cp ?? 0) / 100
  return (v > 0 ? '+' : '') + v.toFixed(2)
}

export default function EngineTestScreen() {
  const { engine, settings } = useApp()
  const [fen, setFen] = useState(START_FEN)
  const [live, setLive] = useState<LiveUpdate | null>(null)
  const [running, setRunning] = useState(false)
  const [scan, setScan] = useState<{ done: number; total: number; ms: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fenRef = useRef(fen)

  useEffect(() => {
    const off = window.api.onLiveUpdate((u) => {
      // Bỏ qua kết quả trễ của vị trí cũ.
      if (u.fen === fenRef.current) setLive(u)
    })
    return () => {
      off()
      void window.api.stopLive()
    }
  }, [])

  const toggleLive = async () => {
    setError(null)
    if (running) {
      await window.api.stopLive()
      setRunning(false)
      return
    }
    fenRef.current = fen
    setLive(null)
    try {
      await window.api.startLive(fen, settings?.multiPv ?? 3)
      setRunning(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** Quét thử 1 ván mẫu ~43 vị trí qua engine pool, đo thời gian. */
  const runScan = async () => {
    setError(null)
    const fens = gameFens(SAMPLE_PGN)
    const t0 = performance.now()
    let done = 0
    setScan({ done, total: fens.length, ms: 0 })
    try {
      await Promise.all(
        fens.map((f) =>
          window.api.analyze(f, { movetime: settings?.quickMovetimeMs ?? 250 }, 2, 'game').then(() => {
            done++
            setScan({ done, total: fens.length, ms: performance.now() - t0 })
          })
        )
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!engine?.ready) {
    return (
      <div className="p-8">
        <Notice kind="error">Engine chưa sẵn sàng: {engine?.error ?? 'đang khởi động...'}</Notice>
        <p className="mt-2 text-muted">Vào Cài đặt để chọn file Stockfish hoặc bấm "Tự tải Stockfish 19".</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Kiểm tra engine</h1>

      <section className="space-y-3 rounded-lg border border-line bg-panel p-5">
        <h2 className="font-semibold">Phân tích trực tiếp (engine riêng, vô hạn)</h2>
        <div className="flex gap-2">
          <Input value={fen} onChange={(e) => setFen(e.target.value)} disabled={running} />
          <Button variant="primary" onClick={() => void toggleLive()}>
            {running ? 'Dừng' : 'Phân tích'}
          </Button>
        </div>
        {live && (
          <div className="space-y-1 font-mono text-sm">
            <div className="text-muted">
              depth {live.depth} · {live.nps ? `${(live.nps / 1e6).toFixed(2)} Mn/s` : ''} {live.done ? '· đã dừng' : ''}
            </div>
            {live.lines.map((l: EngineLine) => (
              <div key={l.multipv} className="truncate">
                <span className="inline-block w-16 font-semibold">{formatScore(l.score)}</span>
                {l.pv.slice(0, 12).join(' ')}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-panel p-5">
        <h2 className="font-semibold">Quét thử một ván qua engine pool</h2>
        <p className="text-muted">
          Ván mẫu ~43 vị trí, {settings?.quickMovetimeMs}ms/vị trí, MultiPV 2, {engine.poolSize} engine song song. Lần chạy
          thứ 2 sẽ lấy từ cache.
        </p>
        <Button onClick={() => void runScan()}>Bắt đầu quét</Button>
        {scan && (
          <div>
            <div className="h-2 overflow-hidden rounded bg-panel-2">
              <div className="h-full bg-accent transition-all" style={{ width: `${(scan.done / scan.total) * 100}%` }} />
            </div>
            <div className="mt-1 text-sm text-muted">
              {scan.done}/{scan.total} vị trí · {(scan.ms / 1000).toFixed(1)}s
            </div>
          </div>
        )}
      </section>
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  )
}
