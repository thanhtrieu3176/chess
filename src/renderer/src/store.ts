import { create } from 'zustand'
import type { EngineStatus, Settings } from '@shared/types'

export type Screen = 'library' | 'analysis' | 'sandbox' | 'stats' | 'puzzles' | 'repertoire' | 'settings'

interface AppState {
  screen: Screen
  settings: Settings | null
  engine: EngineStatus | null
  setScreen: (s: Screen) => void
  loadSettings: () => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  refreshEngine: () => Promise<void>
}

export const useApp = create<AppState>((set) => ({
  screen: 'analysis',
  settings: null,
  engine: null,
  setScreen: (screen) => set({ screen }),
  loadSettings: async () => {
    const settings = await window.api.getSettings()
    applyTheme(settings.theme)
    set({ settings })
  },
  saveSettings: async (patch) => {
    const settings = await window.api.saveSettings(patch)
    applyTheme(settings.theme)
    set({ settings })
  },
  refreshEngine: async () => set({ engine: await window.api.engineStatus() })
}))

function applyTheme(theme: Settings['theme']): void {
  document.documentElement.classList.toggle('light', theme === 'light')
}
