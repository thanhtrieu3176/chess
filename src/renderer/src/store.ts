import { create } from 'zustand'
import type { EngineStatus, Settings } from '@shared/types'
import { setSoundEnabled } from './lib/sound'

export type Screen = 'library' | 'analysis' | 'sandbox' | 'stats' | 'puzzles' | 'repertoire' | 'settings'

interface AppState {
  screen: Screen
  settings: Settings | null
  engine: EngineStatus | null
  /** Ván đang mở ở màn hình Phân tích. */
  gameId: number | null
  /** FEN khởi đầu cho Sandbox (khi mở từ màn hình khác). */
  sandboxFen: string | null
  /** Thông báo nhanh (toast). */
  toast: { text: string; kind: 'ok' | 'error' | 'info' } | null
  setScreen: (s: Screen) => void
  openGame: (id: number) => void
  openSandbox: (fen: string | null) => void
  loadSettings: () => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  refreshEngine: () => Promise<void>
  notify: (text: string, kind?: 'ok' | 'error' | 'info') => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useApp = create<AppState>((set) => ({
  screen: 'library',
  settings: null,
  engine: null,
  gameId: null,
  sandboxFen: null,
  toast: null,
  setScreen: (screen) => set({ screen }),
  openGame: (gameId) => set({ gameId, screen: 'analysis' }),
  openSandbox: (sandboxFen) => set({ sandboxFen, screen: 'sandbox' }),
  loadSettings: async () => {
    const settings = await window.api.getSettings()
    apply(settings)
    set({ settings })
  },
  saveSettings: async (patch) => {
    const settings = await window.api.saveSettings(patch)
    apply(settings)
    set({ settings })
  },
  refreshEngine: async () => set({ engine: await window.api.engineStatus() }),
  notify: (text, kind = 'info') => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: { text, kind } })
    toastTimer = setTimeout(() => set({ toast: null }), 4000)
  }
}))

function apply(s: Settings): void {
  document.documentElement.classList.toggle('light', s.theme === 'light')
  setSoundEnabled(s.sound)
}
