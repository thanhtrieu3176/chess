import { useEffect, useState } from 'react'
import type { DownloadProgress, Settings } from '@shared/types'
import { useApp } from '../store'
import { Button, Field, Input, Notice, Section } from '../components/ui'

type Msg = { kind: 'ok' | 'error' | 'info'; text: string } | null

export default function SettingsScreen() {
  const { settings, saveSettings, engine, refreshEngine } = useApp()
  const [draft, setDraft] = useState<Settings | null>(settings)
  const [engineMsg, setEngineMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const [download, setDownload] = useState<DownloadProgress | null>(null)
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [geminiMsg, setGeminiMsg] = useState<Msg>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => setDraft(settings), [settings])
  useEffect(() => {
    void window.api.hasGeminiKey().then(setHasKey)
    return window.api.onDownloadProgress(setDownload)
  }, [])

  if (!draft) return null
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft({ ...draft, [k]: v })
    setSaved(false)
  }
  const num = (k: keyof Settings, min: number, max: number) => ({
    type: 'number',
    min,
    max,
    value: String(draft[k]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      set(k, Math.min(max, Math.max(min, Number(e.target.value) || min)) as never)
  })

  /** Kiểm tra engine bằng handshake uci → uciok, nếu được thì lưu và khởi động lại pool. */
  const applyEngine = async (path: string) => {
    setBusy(true)
    setEngineMsg({ kind: 'info', text: 'Đang kiểm tra engine...' })
    const r = await window.api.testEngine(path)
    if (r.ok) {
      await saveSettings({ ...draft, enginePath: path })
      const st = await window.api.restartEngines()
      setEngineMsg(
        st.ready
          ? { kind: 'ok', text: `OK: ${r.name}` }
          : { kind: 'error', text: st.error ?? 'Không khởi động được engine' }
      )
      await refreshEngine()
    } else {
      setEngineMsg({ kind: 'error', text: `Không dùng được file này: ${r.error}` })
    }
    setBusy(false)
  }

  const pick = async () => {
    const path = await window.api.pickEngineFile()
    if (path) await applyEngine(path)
  }

  const doDownload = async () => {
    setBusy(true)
    setEngineMsg(null)
    const r = await window.api.downloadStockfish()
    setBusy(false)
    setDownload(null)
    if (r.ok && r.path) await applyEngine(r.path)
    else setEngineMsg({ kind: 'error', text: r.error ?? 'Tải thất bại' })
  }

  const saveAll = async () => {
    await saveSettings(draft)
    const engineChanged = (['poolSize', 'poolThreads', 'liveThreads', 'hashMb', 'syzygyPath'] as const).some(
      (k) => draft[k] !== settings?.[k]
    )
    if (engineChanged && draft.enginePath) {
      setEngineMsg({ kind: 'info', text: 'Đang khởi động lại engine...' })
      const st = await window.api.restartEngines()
      setEngineMsg(st.ready ? { kind: 'ok', text: 'Đã áp dụng cấu hình engine mới' } : { kind: 'error', text: st.error ?? '' })
      await refreshEngine()
    }
    setSaved(true)
  }

  const saveKey = async () => {
    try {
      await window.api.setGeminiKey(key)
      setKey('')
      setHasKey(await window.api.hasGeminiKey())
      setGeminiMsg({ kind: 'ok', text: 'Đã lưu key (mã hóa)' })
    } catch (e) {
      setGeminiMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  const testGemini = async () => {
    await saveSettings({ geminiModel: draft.geminiModel })
    setGeminiMsg({ kind: 'info', text: 'Đang kiểm tra...' })
    const r = await window.api.testGemini()
    setGeminiMsg({ kind: r.ok ? 'ok' : 'error', text: r.message })
  }

  const pct = download?.total && download.received ? Math.round((download.received / download.total) * 100) : null

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <h1 className="text-xl font-semibold">Cài đặt</h1>

      <Section title="Cá nhân">
        <Field label="Tên hiển thị">
          <Input value={draft.displayName} onChange={(e) => set('displayName', e.target.value)} />
        </Field>
        <Field label="Tài khoản Chess.com">
          <Input value={draft.chesscomUsername} onChange={(e) => set('chesscomUsername', e.target.value.trim())} />
        </Field>
        <Field label="Tài khoản Lichess" hint="Không bắt buộc">
          <Input value={draft.lichessUsername} onChange={(e) => set('lichessUsername', e.target.value.trim())} />
        </Field>
        <Field label="Tự tải ván mới khi mở app">
          <input
            type="checkbox"
            checked={draft.autoFetchOnStart}
            onChange={(e) => set('autoFetchOnStart', e.target.checked)}
          />
        </Field>
        <Field label="Giao diện">
          <select
            className="rounded border border-line bg-panel-2 px-2 py-1.5"
            value={draft.theme}
            onChange={(e) => set('theme', e.target.value as Settings['theme'])}
          >
            <option value="dark">Tối</option>
            <option value="light">Sáng</option>
          </select>
        </Field>
        <Field label="Màu bàn cờ">
          <select className="rounded border border-line bg-panel-2 px-2 py-1.5" value={draft.boardTheme} onChange={(e) => set('boardTheme', e.target.value as Settings['boardTheme'])}>
            <option value="brown">Nâu</option>
            <option value="blue">Xanh dương</option>
            <option value="green">Xanh lá</option>
            <option value="gray">Xám</option>
          </select>
        </Field>
        <Field label="Bộ quân cờ">
          <select className="rounded border border-line bg-panel-2 px-2 py-1.5" value={draft.pieceSet} onChange={(e) => set('pieceSet', e.target.value as Settings['pieceSet'])}>
            <option value="cburnett">CBurnett</option>
            <option value="merida">Merida</option>
            <option value="alpha">Alpha</option>
          </select>
        </Field>
        <Field label="Âm thanh đi quân">
          <input type="checkbox" checked={draft.sound} onChange={(e) => set('sound', e.target.checked)} />
        </Field>
      </Section>

      <Section title="Engine (Stockfish)">
        <Field label="File engine">
          <div className="flex gap-2">
            <Input readOnly value={draft.enginePath ?? ''} placeholder="Chưa chọn" />
            <Button onClick={() => void pick()} disabled={busy}>
              Chọn file...
            </Button>
          </div>
        </Field>
        <Field label="" hint="Tải bản chính thức Stockfish 19 (Windows, ~78MB) từ GitHub, có kiểm tra SHA-256.">
          <Button variant="primary" onClick={() => void doDownload()} disabled={busy}>
            Tự tải Stockfish 19
          </Button>
        </Field>
        {download && download.stage !== 'done' && download.stage !== 'error' && (
          <Notice kind="info">
            {download.stage === 'download'
              ? `Đang tải... ${pct ?? '?'}% (${((download.received ?? 0) / 1e6).toFixed(1)} MB)`
              : download.stage === 'verify'
                ? 'Đang kiểm tra SHA-256...'
                : 'Đang giải nén...'}
          </Notice>
        )}
        {engineMsg && <Notice kind={engineMsg.kind}>{engineMsg.text}</Notice>}
        {engine && (
          <Notice kind={engine.ready ? 'ok' : 'error'}>
            Trạng thái: {engine.ready ? `${engine.name} — ${engine.poolSize} engine quét + 1 engine trực tiếp` : engine.error}
          </Notice>
        )}

        <Field label="Số engine quét song song" hint="Mỗi engine chạy 1 tiến trình Stockfish riêng.">
          <Input {...num('poolSize', 1, 8)} />
        </Field>
        <Field label="Thread mỗi engine quét">
          <Input {...num('poolThreads', 1, 64)} />
        </Field>
        <Field label="Thread engine trực tiếp" hint="Dùng khi xem từng nước / sandbox.">
          <Input {...num('liveThreads', 1, 64)} />
        </Field>
        <Field label="Hash mỗi engine (MB)">
          <Input {...num('hashMb', 16, 4096)} />
        </Field>
        <Field label="Quét nhanh (ms / vị trí)">
          <Input {...num('quickMovetimeMs', 50, 5000)} />
        </Field>
        <Field label="Độ sâu phân tích kỹ">
          <Input {...num('deepDepth', 10, 40)} />
        </Field>
        <Field label="MultiPV (số biến)">
          <Input {...num('multiPv', 1, 5)} />
        </Field>
        <Field label="SyzygyPath" hint="Không bắt buộc. Thư mục chứa file tablebase Syzygy.">
          <Input value={draft.syzygyPath} onChange={(e) => set('syzygyPath', e.target.value)} />
        </Field>
        <Field label="Phân tích nền" hint="Tự quét nhanh các ván mới tải về khi rảnh.">
          <input type="checkbox" checked={draft.backgroundAnalysis} onChange={(e) => set('backgroundAnalysis', e.target.checked)} />
        </Field>
        <Field label="Engine dành cho phân tích nền" hint="Giới hạn CPU khi phân tích nền (không quá số engine quét).">
          <Input {...num('backgroundEngines', 1, 8)} />
        </Field>
      </Section>

      <Section title="Gemini (giải thích bằng lời)">
        <Field
          label="API key"
          hint={hasKey ? 'Đã có key. Nhập key mới để thay, để trống rồi Lưu để xóa.' : 'Lấy miễn phí tại aistudio.google.com/apikey'}
        >
          <div className="flex gap-2">
            <Input type="password" value={key} placeholder={hasKey ? '••••••••' : 'AIza...'} onChange={(e) => setKey(e.target.value)} />
            <Button onClick={() => void saveKey()}>Lưu key</Button>
          </div>
        </Field>
        <Field label="Model" hint="Tên model thay đổi theo thời gian; xem danh sách ở Google AI Studio.">
          <div className="flex gap-2">
            <Input value={draft.geminiModel} onChange={(e) => set('geminiModel', e.target.value.trim())} />
            <Button onClick={() => void testGemini()}>Kiểm tra kết nối</Button>
          </div>
        </Field>
        <Field label="Giới hạn request/phút" hint="Gói miễn phí giới hạn số request mỗi phút; app tự xếp hàng và thử lại khi gặp lỗi 429.">
          <Input {...num('geminiRpm', 1, 60)} />
        </Field>
        <Field label="Tự giải thích khoảnh khắc quan trọng" hint="Brilliant, Great, Mistake, Miss, Blunder — tải trước ở chế độ nền sau khi phân tích.">
          <input type="checkbox" checked={draft.geminiAutoExplain} onChange={(e) => set('geminiAutoExplain', e.target.checked)} />
        </Field>
        <Field label="Gộp nhiều khoảnh khắc / request" hint="Tiết kiệm quota: tối đa 6 khoảnh khắc của một ván trong 1 request.">
          <input type="checkbox" checked={draft.geminiBatch} onChange={(e) => set('geminiBatch', e.target.checked)} />
        </Field>
        {geminiMsg && <Notice kind={geminiMsg.kind}>{geminiMsg.text}</Notice>}
      </Section>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={() => void saveAll()}>
          Lưu cài đặt
        </Button>
        {saved && <Notice kind="ok">Đã lưu</Notice>}
        <Button className="ml-auto" onClick={() => void window.api.openLogFolder()}>
          Mở thư mục log
        </Button>
      </div>
    </div>
  )
}
