import { create } from "zustand";
import { useMemo } from "react";
import {
  themes,
  DEFAULT_THEME_ID,
  themeConfig,
  type Theme,
  type ThemeConfig,
} from "../styles/theme";
import { useSettingsStore, useCustomThemes } from "./settingsStore";

export interface ThemeStore {
  // ウィンドウ独立の「現在のテーマ ID」。settings.theme.currentThemeId と
  // 同期するのは起動時の 1 回のみ。それ以降は各ウィンドウで独立して切り替え可能。
  currentThemeId: string;
  config: ThemeConfig;
  // SettingsModal で編集中の一時テーマ。null でない間は useCurrentTheme が
  // これを優先返却するため、後ろのターミナルにライブプレビューが反映される。
  // 「保存」で settings 永続化 → null クリア、「キャンセル」/モーダル閉で null クリア。
  overrideTheme: Theme | null;
  setTheme: (themeId: string) => void;
  setThemeIdLocal: (themeId: string) => void;
  setOverrideTheme: (theme: Theme | null) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  currentThemeId: DEFAULT_THEME_ID,
  config: themeConfig,
  overrideTheme: null,

  setTheme: (themeId: string): void => {
    // テーマ切替時は override を必ずクリア（古い editing が新テーマに混ざらないように）
    set({ currentThemeId: themeId, overrideTheme: null });
    useSettingsStore.getState().update({
      theme: { currentThemeId: themeId },
    });
  },

  setThemeIdLocal: (themeId: string): void => {
    set({ currentThemeId: themeId });
  },

  setOverrideTheme: (theme: Theme | null): void => {
    set({ overrideTheme: theme });
  },
}));

// 組込プリセット + ユーザー定義テーマの結合リストを返すリアクティブセレクタ。
export const useAvailableThemes = (): Theme[] => {
  const customThemes = useCustomThemes();
  return useMemo(
    () => [...Object.values(themes), ...customThemes],
    [customThemes],
  );
};

// 現在テーマを解決するセレクタ。
// 優先順位: overrideTheme（編集中 draft）> 組込 > customThemes > default
// override があればターミナル本体にもライブプレビューが映る。
export const useCurrentTheme = (): Theme => {
  const overrideTheme = useThemeStore((s) => s.overrideTheme);
  const currentThemeId = useThemeStore((s) => s.currentThemeId);
  const customThemes = useCustomThemes();
  return useMemo(() => {
    if (overrideTheme) return overrideTheme;
    if (themes[currentThemeId]) return themes[currentThemeId];
    const found = customThemes.find((t) => t.id === currentThemeId);
    if (found) return found;
    return themes[DEFAULT_THEME_ID];
  }, [overrideTheme, currentThemeId, customThemes]);
};

export const useSetTheme = (): ((themeId: string) => void) =>
  useThemeStore((s) => s.setTheme);
export const useThemeConfig = (): ThemeConfig => useThemeStore((s) => s.config);

// ========== Custom theme operations ==========
// custom themes は settings に永続化される。themeStore からはこれらのヘルパーを
// 経由して操作する。settings broadcast によって全ウィンドウへ即時反映される。

export function addCustomTheme(theme: Theme): void {
  const current = useSettingsStore.getState().settings.theme.customThemes;
  // 同 id があれば置換、なければ追加
  const exists = current.some((t) => t.id === theme.id);
  const next = exists
    ? current.map((t) => (t.id === theme.id ? theme : t))
    : [...current, theme];
  useSettingsStore.getState().update({
    theme: { customThemes: next },
  });
}

export function updateCustomTheme(theme: Theme): void {
  const current = useSettingsStore.getState().settings.theme.customThemes;
  const next = current.map((t) => (t.id === theme.id ? theme : t));
  useSettingsStore.getState().update({
    theme: { customThemes: next },
  });
}

export function deleteCustomTheme(themeId: string): void {
  const settingsState = useSettingsStore.getState();
  const current = settingsState.settings.theme.customThemes;
  const next = current.filter((t) => t.id !== themeId);
  // 現在表示中のテーマを削除した場合は default に戻す
  const themeStoreState = useThemeStore.getState();
  if (themeStoreState.currentThemeId === themeId) {
    useThemeStore.setState({ currentThemeId: DEFAULT_THEME_ID });
  }
  const currentThemeIdInSettings = settingsState.settings.theme.currentThemeId;
  const patchTheme: { customThemes: Theme[]; currentThemeId?: string } = {
    customThemes: next,
  };
  if (currentThemeIdInSettings === themeId) {
    patchTheme.currentThemeId = DEFAULT_THEME_ID;
  }
  useSettingsStore.getState().update({ theme: patchTheme });
}
