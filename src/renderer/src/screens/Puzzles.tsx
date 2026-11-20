import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DrawShape } from 'chessground/draw'
import type { Puzzle } from '@shared/types'
import { CLASS_INFO } from '@shared/analysis/classify'
import { fromFen, playUci, pvToSan } from '@shared/chess/position'
import { MOTIF_VI, type MotifKind } from '@shared/tactics'
import { useApp } from '../store'
import { arrow, Board, circle } from '../components/Board'
import { Explanation } from '../components/Explanation'
import { Button, Notice } from '../components/ui'
import { playErrorSound, playMoveSound } from '../lib/sound'

type State = 'solving' | 'wrong' | 'solved' | 'revealed'

/** Luyện lại sai lầm: puzzle tạo từ nước Mistake/Blunder/Miss của chính tôi, lặp lại ngắt quãng SM-2. */
export default function PuzzlesScreen() {
  const { openGame } = useApp()
  const [summary, setSummary] = useState<{ total: number; due: number; motifs: { kind: string; count: number }[] } | null>(null)
  const [motif, setMotif] = useState<string | undefined>()
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [step, setStep] = useState(0)
  const [fen, setFen] = useState('')
  const [lastMove, setLastMove] = useState<string | null>(null)
  const [state, setState] = useState<State>('solving')
  const [hint, setHint] = useState(false)
  const [mistakes, setMistakes] = useState(0)
  const [sync, setSync] = useState(0)

  const refresh = () => void window.api.puzzleSummary().then(setSummary)
  const load = useCallback(
    async (excludeId?: number) => {
      const p = await window.api.nextPuzzle(motif, excludeId)
      setPuzzle(p)
      setStep(0)
      setFen(p?.fen ?? '')
      setLastMove(null)
      setState('solving')
      setHint(false)
      setMistakes(0)
    },
    [motif]
  )
  useEffect(refresh, [])
  useEffect(() => void load(), [load])

  const orientation = useMemo(() => (puzzle ? fromFen(puzzle.fen).turn : 'white'), [puzzle])
  const solutionSan = useMemo(() => (puzzle ? pvToSan(puzzle.fen, puzzle.solution) : []), [puzzle])

  /** Kết thúc: chấm SM-2 (5 = đúng ngay, 4 = cần gợi ý, 2 = có sai, 0 = xem lời giải). */
  const finish = async (quality: number) => {
    if (!puzzle) return
    await window.api.gradePuzzle(puzzle.id, quality)
    refresh()
  }

  const onMove = (uci: string) => {
    if (!puzzle || state === 'solved' || state === 'revealed') return
    const expected = puzzle.solution[step]
    const played = playUci(fen, uci)
    if (!played) return
    // Chấp nhận nước khác nếu đó cũng là chiếu hết.
    const ok = uci === expected || (played.san.includes('#') && fromFen(played.fen).isCheckmate())
    if (!ok) {
      playErrorSound()
      setMistakes((m) => m + 1)
      setState('wrong')
      setSync((n) => n + 1) // trả bàn cờ về vị trí cũ
      return
    }
    playMoveSound(played.san)
    setFen(played.fen)
    setLastMove(uci)
    setState('solving')
    const next = step + 1
    if (next >= puzzle.solution.length || played.san.includes('#')) {
      setState('solved')
      void finish(mistakes > 0 ? 2 : hint ? 4 : 5)
      return
    }
    // Máy đi nước đáp trả.
    setTimeout(() => {
      const reply = playUci(played.fen, puzzle.solution[next]!)
      if (!reply) return
      playMoveSound(reply.san)
      setFen(reply.fen)
      setLastMove(puzzle.solution[next]!)
      setStep(next + 1)
    }, 450)
    setStep(next)
  }

  const reveal = async () => {
    if (!puzzle) return
    setState('revealed')
    void finish(0)
    let f = fen
    for (let i = step; i < puzzle.solution.length; i++) {
      await new Promise((r) => setTimeout(r, 600))
      const r = playUci(f, puzzle.solution[i]!)
      if (!r) break
      playMoveSound(r.san)
      f = r.fen
      setFen(f)
      setLastMove(puzzle.solution[i]!)
    }
  }

  const shapes = useMemo(() => {
    const s: DrawShape[] = []
    const expected = puzzle?.solution[step]
    if (hint && expected && state !== 'solved') s.push(circle(expected.slice(0, 2), 'green'))
    if (state === 'wrong' && hint && expected) s.push(arrow(expected, 'green'))
    return s
  }, [hint, puzzle, step, state])

  return (
    <div className="flex h-full gap-5 p-6">
      <div className="shrink-0" style={{ width: 'min(68vh, 48vw)' }}>
        {puzzle ? (
          <Board fen={fen} orientation={orientation} lastMove={lastMove} onlyColor={orientation} onMove={onMove} shapes={shapes} syncKey={sync} />
        ) : (
          <div className="flex aspect-square items-center justify-center rounded-lg border border-line bg-panel p-6 text-center text-muted">
            {summary?.total === 0
              ? 'Chưa có puzzle. Puzzle được tạo tự động từ các nước Mistake/Blunder/Miss của bạn sau khi phân tích ván.'
              : 'Không có puzzle cho chủ đề này.'}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-4 overflow-auto">
        <h1 className="text-xl font-semibold">Luyện lại sai lầm</h1>
        {summary && (
          <div className="text-sm text-muted">
            {summary.total} puzzle · <b className="text-fg">{summary.due}</b> đến hạn ôn hôm nay
          </div>
        )}
        <div className="flex flex-wrap gap-2 text-sm">
          <Button variant={!motif ? 'primary' : 'default'} onClick={() => setMotif(undefined)}>
            Tất cả
          </Button>
          {summary?.motifs.map((m) => (
            <Button key={m.kind} variant={motif === m.kind ? 'primary' : 'default'} onClick={() => setMotif(m.kind)}>
              {MOTIF_VI[m.kind as MotifKind] ?? m.kind} ({m.count})
            </Button>
          ))}
        </div>

        {puzzle && (
          <div className="space-y-3 rounded-lg border border-line bg-panel p-4">
            <div className="text-lg font-semibold">{orientation === 'white' ? 'Trắng' : 'Đen'} đi — tìm nước tốt nhất</div>
            <div className="text-sm text-muted">
              Từ ván của bạn, nước {Math.ceil(puzzle.ply / 2)}: bạn đã đi <b>{puzzle.playedSan ?? '?'}</b> (
              <span style={{ color: CLASS_INFO[puzzle.sourceClass].color }}>{CLASS_INFO[puzzle.sourceClass].vi}</span>).{' '}
              {puzzle.dueAt > Date.now() && <span>(chưa đến hạn ôn — luyện thêm)</span>}
            </div>
            {state === 'wrong' && <Notice kind="error">Chưa đúng, thử lại nhé.</Notice>}
            {state === 'solved' && <Notice kind="ok">✓ Chính xác! {mistakes === 0 && !hint ? 'Giải ngay lần đầu.' : ''}</Notice>}
            {state === 'revealed' && <Notice kind="info">Lời giải: {solutionSan.join(' ')}</Notice>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={state === 'solved' || state === 'revealed'} onClick={() => setHint(true)}>
                💡 Gợi ý
              </Button>
              <Button disabled={state === 'solved' || state === 'revealed'} onClick={() => void reveal()}>
                Xem lời giải
              </Button>
              <Button variant="primary" onClick={() => void load(puzzle.id)}>
                Puzzle tiếp theo →
              </Button>
              <Button onClick={() => openGame(puzzle.gameId)}>Mở ván gốc</Button>
            </div>
            {puzzle.motifs.length > 0 && (state === 'solved' || state === 'revealed') && (
              <div className="text-sm text-muted">Chủ đề: {puzzle.motifs.map((m) => MOTIF_VI[m as MotifKind] ?? m).join(', ')}</div>
            )}
            {(state === 'solved' || state === 'revealed') && (
              <Explanation req={{ kind: 'puzzle', puzzleId: puzzle.id }} auto={false} label="Giải thích lời giải" />
            )}
          </div>
        )}
        <div className="text-xs text-muted">
          Lặp lại ngắt quãng (SM-2): giải đúng ngay → ôn lại sau 1, 6, ~15 ngày...; làm sai → quay lại sau 10 phút.
        </div>
      </div>
    </div>
  )
}
