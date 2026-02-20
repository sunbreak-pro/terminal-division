import { create } from 'zustand'
import { themes, DEFAULT_THEME_ID, themeConfig, type Theme, type ThemeConfig } from '../styles/theme'

const STORAGE_KEY = 'terminal-division-theme'

// localStorageからテーマIDを取得
function getStoredThemeId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && themes[stored]) {
      return stored
    }
  } catch {
    // localStorage使用不可の場合は無視
  }
  return DEFAULT_THEME_ID
}

// localStorageにテーマIDを保存
function storeThemeId(themeId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, themeId)
  } catch {
    // localStorage使用不可の場合は無視
  }
}

export interface ThemeStore {
  // 現在のテーマID
  currentThemeId: string
  // 利用可能なテーマ一覧
  availableThemes: Theme[]
  // 現在のテーマを取得
  getCurrentTheme: () => Theme
  // テーマ設定（spacing等）
  config: ThemeConfig
  // テーマを変更
  setTheme: (themeId: string) => void
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  currentThemeId: getStoredThemeId(),
  availableThemes: Object.values(themes),
  config: themeConfig,

  getCurrentTheme: () => {
    const { currentThemeId } = get()
    return themes[currentThemeId] || themes[DEFAULT_THEME_ID]
  },

  setTheme: (themeId: string) => {
    if (!themes[themeId]) {
      console.warn(`Theme "${themeId}" not found, using default`)
      themeId = DEFAULT_THEME_ID
    }

    storeThemeId(themeId)
    set({ currentThemeId: themeId })

    // 他のウィンドウにテーマ変更を通知
    window.api.theme.notifyChanged(themeId)
  }
}))

// セレクターフック
export const useCurrentTheme = (): Theme => {
  const getCurrentTheme = useThemeStore((s) => s.getCurrentTheme)
  const currentThemeId = useThemeStore((s) => s.currentThemeId)
  // currentThemeIdに依存することで、テーマ変更時に再レンダリングされる
  return getCurrentTheme()
}

export const useCurrentThemeId = (): string => useThemeStore((s) => s.currentThemeId)
export const useAvailableThemes = (): Theme[] => useThemeStore((s) => s.availableThemes)
export const useSetTheme = (): ((themeId: string) => void) => useThemeStore((s) => s.setTheme)
export const useThemeConfig = (): ThemeConfig => useThemeStore((s) => s.config)

// 他のウィンドウからのテーマ同期を受信するリスナーを設定
export function setupThemeSync(): () => void {
  return window.api.theme.onSync((themeId: string) => {
    if (themes[themeId]) {
      storeThemeId(themeId)
      useThemeStore.setState({ currentThemeId: themeId })
    }
  })
}
