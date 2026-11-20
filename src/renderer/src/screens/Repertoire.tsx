import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RepertoireNode } from '@shared/types'
import { START_FEN } from '@shared/fen'
import { fromFen, playUci } from '@shared/chess/position'
import { useApp } from '../store'
import { arrow, Board } from '../components/Board'
import { Button, Notice } from '../components/ui'
import { playErrorSound, playMoveSound } from '../lib/sound'

type Mode = 'edit' | 'train'

/** Cây khai cuộc cá nhân cho từng màu: thêm bằng cách đi trên bàn cờ / nhập PGN, ghi chú, luyện tập. */
export default function RepertoireScreen() {
  const { notify } = useApp()
  const [color, setColor] = useState<'w' | 'b'>('w')
  const [nodes, setNodes] = useState<RepertoireNode[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode>('edit')
  const [pgn, setPgn] = useState('')

  const reload = useCallback(() => void window.api.repertoireList(color).then(setNodes), [color])
  useEffect(() => {
    reload()
    setSelected(null)
  }, [reload])

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const children = useMemo(() => {
    const m = new Map<number | null, RepertoireNode[]>()
    for (const n of nodes) m.set(n.parentId, [...(m.get(n.parentId) ?? []), n])
    return m
  }, [nodes])
  const node = selected !== null ? (byId.get(selected) ?? null) : null
  const fen = node?.fen ?? START_FEN
  const orientation = color === 'w' ? 'white' : 'black'

  const add = async (uci: string) => {
    try {
      const n = await window.api.repertoireAdd(color, selected, uci)
      playMoveSound(n.san)
      reload()
      setSelected(n.id)
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const tree = (parentId: number | null, depth: number): ReactNode =>
    (children.get(parentId) ?? []).map((n) => {
      const white = n.parentFen.split(' ')[1] === 'w'
      return (
        <div key={n.id} style={{ marginLeft: depth ? 12 : 0 }} className={depth ? 'border-l border-line pl-2' : ''}>
          <button
            onClick={() => setSelected(n.id)}
            className={`rounded px-1.5 py-0.5 text-sm hover:bg-line ${selected === n.id ? 'bg-accent/30 font-semibold' : ''}`}
          >
            <span className="text-muted">{white ? `${n.fen.split(' ')[5] ?? ''}.` : '…'}</span> {n.san}
            {n.comment && <span className="ml-1 text-xs text-muted">💬</span>}
          </button>
          {tree(n.id, depth + 1)}
        </div>
      )
    })

  return (
    <div className="flex h-full gap-5 p-6">
      <div className="shrink-0 space-y-2" style={{ width: 'min(68vh, 46vw)' }}>
        {mode === 'edit' ? (
          <>
            <Board
              fen={fen}
              orientation={orientation}
              lastMove={node?.uci ?? null}
              onMove={(uci) => void add(uci)}
              shapes={(children.get(selected) ?? []).map((c) => arrow(c.uci, 'blue', 8))}
            />
            <div className="flex gap-2">
              <Button onClick={() => setSelected(node?.parentId ?? null)} disabled={!node}>
                ◀ Lùi
              </Button>
              <Button onClick={() => setSelected(null)}>⏮ Vị trí đầu</Button>
            </div>
            <div className="text-xs text-muted">Đi quân trên bàn cờ để thêm nước vào repertoire (mũi tên xanh = nước đã có).</div>
          </>
        ) : (
          <Trainer color={color} />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-4 overflow-auto">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-3 text-xl font-semibold">Repertoire</h1>
          <Button variant={color === 'w' ? 'primary' : 'default'} onClick={() => setColor('w')}>
            Quân Trắng
          </Button>
          <Button variant={color === 'b' ? 'primary' : 'default'} onClick={() => setColor('b')}>
            Quân Đen
          </Button>
          <span className="mx-2 text-line">|</span>
          <Button variant={mode === 'edit' ? 'primary' : 'default'} onClick={() => setMode('edit')}>
            Soạn
          </Button>
          <Button variant={mode === 'train' ? 'primary' : 'default'} onClick={() => setMode('train')} disabled={nodes.length === 0}>
            Luyện tập
          </Button>
        </div>

        {mode === 'edit' && (
          <>
            <div className="max-h-96 overflow-auto rounded-lg border border-line bg-panel p-3">
              {nodes.length === 0 ? <div className="text-sm text-muted">Repertoire trống. Đi quân trên bàn cờ hoặc nhập PGN.</div> : tree(null, 0)}
            </div>

            {node && (
              <div className="space-y-2 rounded-lg border border-line bg-panel p-3">
                <div className="font-semibold">Nước {node.san}</div>
                <textarea
                  key={node.id}
                  className="h-20 w-full rounded border border-line bg-panel-2 p-2 text-sm"
                  placeholder="Ghi chú cho nước này (ý tưởng, kế hoạch...)"
                  defaultValue={node.comment}
                  onBlur={(e) => void window.api.repertoireComment(node.id, e.target.value.trim()).then(reload)}
                />
                <Button
                  onClick={() => {
                    if (!confirm(`Xóa ${node.san} và toàn bộ nhánh sau nó?`)) return
                    void window.api.repertoireDelete(node.id).then(() => {
                      setSelected(node.parentId)
                      reload()
                    })
                  }}
                >
                  Xóa nhánh này
                </Button>
              </div>
            )}

            <div className="space-y-2 rounded-lg border border-line bg-panel p-3">
              <div className="font-semibold">Nhập từ PGN (kèm biến phụ & chú thích)</div>
              <textarea
                className="h-24 w-full rounded border border-line bg-panel-2 p-2 font-mono text-xs"
                placeholder="1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 3. Bb5 *"
                value={pgn}
                onChange={(e) => setPgn(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  disabled={!pgn.trim()}
                  onClick={() =>
                    void window.api
                      .repertoireImport(color, pgn)
                      .then((n) => {
                        notify(`Đã thêm ${n} nước`, 'ok')
                        setPgn('')
                        reload()
                      })
                      .catch((e: unknown) => notify(String(e), 'error'))
                  }
                >
                  Nhập
                </Button>
                <Button
                  onClick={() =>
                    void window.api.repertoireImportFile(color).then((n) => {
                      if (n !== null) {
                        notify(`Đã thêm ${n} nước`, 'ok')
                        reload()
                      }
                    })
                  }
                >
                  Mở file .pgn...
                </Button>
              </div>
            </div>
            <div className="text-xs text-muted">
              Khi phân tích ván, app tự so với repertoire của màu bạn cầm và báo nước bạn lệch hoặc nước đối thủ đi ngoài repertoire.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Chế độ luyện: app đi nước của đối thủ (ngẫu nhiên trong repertoire), bạn phải đi đúng nước đã chuẩn bị. */
function Trainer({ color }: { color: 'w' | 'b' }) {
  const [fen, setFen] = useState(START_FEN)
  const [lastMove, setLastMove] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null)
  const [expected, setExpected] = useState<string[]>([])
  const [sync, setSync] = useState(0)
  const [score, setScore] = useState({ ok: 0, bad: 0 })
  const myTurn = (f: string) => (fromFen(f).turn === 'white') === (color === 'w')

  const step = useCallback(
    async (f: string) => {
      const options = await window.api.repertoireMovesAt(color, f)
      if (options.length === 0) {
        setMsg({ kind: 'ok', text: 'Hết nhánh repertoire. Bấm "Bắt đầu lại" để luyện tiếp.' })
        return
      }
      if (myTurn(f)) {
        setExpected(options.map((o) => o.uci))
        setMsg({ kind: 'info', text: 'Đến lượt bạn: đi nước trong repertoire.' })
        return
      }
      const pick = options[Math.floor(Math.random() * options.length)]!
      setTimeout(() => {
        const r = playUci(f, pick.uci)
        if (!r) return
        playMoveSound(r.san)
        setFen(r.fen)
        setLastMove(pick.uci)
        void step(r.fen)
      }, 450)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [color]
  )

  const restart = useCallback(() => {
    setFen(START_FEN)
    setLastMove(null)
    setExpected([])
    setMsg(null)
    void step(START_FEN)
  }, [step])
  useEffect(restart, [restart])

  const onMove = (uci: string) => {
    if (!expected.includes(uci)) {
      playErrorSound()
      setScore((s) => ({ ...s, bad: s.bad + 1 }))
      const sans = expected.map((u) => playUci(fen, u)?.san).filter(Boolean)
      setMsg({ kind: 'error', text: `Chưa đúng. Repertoire: ${sans.join(' / ') || '(trống)'}` })
      setSync((n) => n + 1)
      return
    }
    const r = playUci(fen, uci)!
    playMoveSound(r.san)
    setScore((s) => ({ ...s, ok: s.ok + 1 }))
    setFen(r.fen)
    setLastMove(uci)
    setExpected([])
    setMsg(null)
    void step(r.fen)
  }

  return (
    <div className="space-y-2">
      <Board fen={fen} orientation={color === 'w' ? 'white' : 'black'} lastMove={lastMove} onlyColor={color === 'w' ? 'white' : 'black'} onMove={onMove} syncKey={sync} />
      <div className="flex items-center gap-3">
        <Button onClick={restart}>↻ Bắt đầu lại</Button>
        <span className="text-sm text-muted">
          Đúng {score.ok} · Sai {score.bad}
        </span>
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </div>
  )
}
