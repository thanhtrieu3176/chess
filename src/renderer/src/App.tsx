import { lazy, Suspense, useEffect, useState } from 'react'
import { useApp, type Screen } from './store'
import { ErrorBoundary } from './components/ErrorBoundary'
import { GeminiKeyDialog } from './components/GeminiKeyDialog'

// Các màn hình tải lười để app khởi động nhanh.
const Library = lazy(() => import('./screens/Library'))
const Workspace = lazy(() => import('./screens/Workspace'))
const Stats = lazy(() => import('./screens/Stats'))
const Puzzles = lazy(() => import('./screens/Puzzles'))
const Repertoire = lazy(() => import('./screens/Repertoire'))
const SettingsScreen = lazy(() => import('./screens/Settings'))

const NAV: { id: Screen; label: string; icon: string }[] = [
  { id: 'library', label: 'Thư viện ván', icon: '📚' },
  { id: 'analysis', label: 'Phân tích', icon: '🔍' },
  { id: 'sandbox', label: 'Sandbox', icon: '🧪' },
  { id: 'stats', label: 'Thống kê', icon: '📊' },
  { id: 'puzzles', label: 'Puzzle', icon: '🧩' },
  { id: 'repertoire', label: 'Repertoire', icon: '🌳' },
  { id: 'settings', label: 'Cài đặt', icon: '⚙️' }
]

function ScreenView({ screen }: { screen: Screen }) {
  switch (screen) {
    case 'library':
      return <Library />
    case 'analysis':
      return <Workspace mode="game" />
    case 'sandbox':
      return <Workspace mode="sandbox" />
    case 'stats':
      return <Stats />
    case 'puzzles':
      return <Puzzles />
    case 'repertoire':
      return <Repertoire />
    case 'settings':
      return <SettingsScreen />
  }
}

export function App() {
  const { screen, setScreen, settings, engine, loadSettings, refreshEngine, toast } = useApp()
  const [askKey, setAskKey] = useState(false)
  const [fetchMsg, setFetchMsg] = useState<string | null>(null)

  useEffect(() => {
    void loadSettings()
    void refreshEngine()
    // Engine khởi động nền sau khi mở app → hỏi lại trạng thái định kỳ.
    const t = setInterval(() => void refreshEngine(), 3000)
    void window.api.hasGeminiKey().then((has) => {
      let skip = false
      try {
        skip = localStorage.getItem('skipGeminiKeyDialog') === '1'
      } catch {
        // bỏ qua
      }
      if (!has && !skip) setAskKey(true)
    })
    const off = window.api.onFetchProgress((p) => {
      setFetchMsg(p.message)
      if (p.done) setTimeout(() => setFetchMsg(null), 6000)
    })
    return () => {
      clearInterval(t)
      off()
    }
  }, [loadSettings, refreshEngine])

  if (!settings) return null

  return (
    <div className="flex h-full">
      <nav className="flex w-52 shrink-0 flex-col border-r border-line bg-panel">
        <div className="px-4 py-4">
          <div className="text-xs text-muted">Xin chào,</div>
          <div className="font-semibold">{settings.displayName}</div>
        </div>
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => setScreen(n.id)}
            className={`flex items-center gap-3 px-4 py-2.5 text-left hover:bg-panel-2 ${
              screen === n.id ? 'border-l-2 border-accent bg-panel-2 font-medium' : 'border-l-2 border-transparent'
            }`}
          >
            <span>{n.icon}</span>
            {n.label}
          </button>
        ))}
        <div className="mt-auto space-y-1 border-t border-line px-4 py-3 text-xs">
          {fetchMsg && <div className="text-muted">{fetchMsg}</div>}
          {engine?.ready ? (
            <span className="text-accent">
              ● {engine.name}
              {engine.queued > 0 ? ` · ${engine.queued} chờ` : ''}
            </span>
          ) : (
            <button className="text-left text-warn" onClick={() => setScreen('settings')}>
              ● {engine?.error ?? 'Đang khởi động engine...'}
            </button>
          )}
        </div>
      </nav>

      <main className="min-w-0 flex-1 overflow-auto">
        <ErrorBoundary area={NAV.find((n) => n.id === screen)?.label ?? screen} key={screen}>
          <Suspense fallback={<div className="p-6 text-muted">Đang tải...</div>}>
            <ScreenView screen={screen} />
          </Suspense>
        </ErrorBoundary>
      </main>

      {askKey && <GeminiKeyDialog onClose={() => setAskKey(false)} />}
      {toast && (
        <div
          className={`fixed right-4 bottom-4 z-50 max-w-md rounded-lg border px-4 py-2 shadow-lg ${
            toast.kind === 'error' ? 'border-danger bg-panel text-danger' : toast.kind === 'ok' ? 'border-accent bg-panel' : 'border-line bg-panel'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}
