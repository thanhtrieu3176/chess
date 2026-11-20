import { lazy, Suspense, useEffect, useState } from 'react'
import { useApp, type Screen } from './store'
import { ErrorBoundary } from './components/ErrorBoundary'
import { GeminiKeyDialog } from './components/GeminiKeyDialog'

// Các màn hình tải lười để app khởi động nhanh.
const SettingsScreen = lazy(() => import('./screens/Settings'))
const EngineTestScreen = lazy(() => import('./screens/EngineTest'))

const NAV: { id: Screen; label: string; icon: string }[] = [
  { id: 'library', label: 'Thư viện ván', icon: '📚' },
  { id: 'analysis', label: 'Phân tích', icon: '🔍' },
  { id: 'sandbox', label: 'Sandbox', icon: '🧪' },
  { id: 'stats', label: 'Thống kê', icon: '📊' },
  { id: 'puzzles', label: 'Puzzle', icon: '🧩' },
  { id: 'repertoire', label: 'Repertoire', icon: '🌳' },
  { id: 'settings', label: 'Cài đặt', icon: '⚙️' }
]

export function App() {
  const { screen, setScreen, settings, engine, loadSettings, refreshEngine } = useApp()
  const [askKey, setAskKey] = useState(false)

  useEffect(() => {
    void loadSettings()
    void refreshEngine()
    // Engine khởi động nền sau khi mở app → hỏi lại trạng thái vài lần.
    const t = setInterval(() => void refreshEngine(), 2000)
    void window.api.hasGeminiKey().then((has) => {
      if (!has && localStorage.getItem('skipGeminiKeyDialog') !== '1') setAskKey(true)
    })
    return () => clearInterval(t)
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
        <div className="mt-auto border-t border-line px-4 py-3 text-xs">
          {engine?.ready ? (
            <span className="text-accent">● {engine.name}</span>
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
            {screen === 'settings' ? (
              <SettingsScreen />
            ) : screen === 'analysis' ? (
              <EngineTestScreen />
            ) : (
              <div className="p-8 text-muted">Màn hình này sẽ được làm ở các giai đoạn sau.</div>
            )}
          </Suspense>
        </ErrorBoundary>
      </main>

      {askKey && <GeminiKeyDialog onClose={() => setAskKey(false)} />}
    </div>
  )
}
