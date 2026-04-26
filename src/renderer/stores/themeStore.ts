import { create } from "zustand";
import {
  themes,
  DEFAULT_THEME_ID,
  themeConfig,
  type Theme,
  type ThemeConfig,
} from "../styles/theme";

export interface ThemeStore {
  // 現在のテーマID
  currentThemeId: string;
  // 利用可能なテーマ一覧
  availableThemes: Theme[];
  // 現在のテーマを取得
  getCurrentTheme: () => Theme;
  // テーマ設定（spacing等）
  config: ThemeConfig;
  // テーマを変更
  setTheme: (themeId: string) => void;
}

// 各ウィンドウは独立したテーマを持つ。永続化・ウィンドウ間同期は意図的に行わず、
// 新規ウィンドウは常に DEFAULT_THEME_ID で起動する。
export const useThemeStore = create<ThemeStore>((set, get) => ({
  currentThemeId: DEFAULT_THEME_ID,
  availableThemes: Object.values(themes),
  config: themeConfig,

  getCurrentTheme: () => {
    const { currentThemeId } = get();
    return themes[currentThemeId] || themes[DEFAULT_THEME_ID];
  },

  setTheme: (themeId: string) => {
    if (!themes[themeId]) {
      console.warn(`Theme "${themeId}" not found, using default`);
      themeId = DEFAULT_THEME_ID;
    }
    set({ currentThemeId: themeId });
  },
}));

// セレクターフック
export const useCurrentTheme = (): Theme => {
  const getCurrentTheme = useThemeStore((s) => s.getCurrentTheme);
  const currentThemeId = useThemeStore((s) => s.currentThemeId);
  // currentThemeIdに依存することで、テーマ変更時に再レンダリングされる
  return getCurrentTheme();
};

export const useAvailableThemes = (): Theme[] =>
  useThemeStore((s) => s.availableThemes);
export const useSetTheme = (): ((themeId: string) => void) =>
  useThemeStore((s) => s.setTheme);
export const useThemeConfig = (): ThemeConfig => useThemeStore((s) => s.config);
