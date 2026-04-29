import { create } from "zustand";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type PartialAppSettings,
} from "../../shared/settings";
import { useTerminalMetaStore } from "./terminalMetaStore";

export interface SettingsStore {
  settings: AppSettings;
  // 起動時の初回 load() が完了したか。それまでは設定 UI は disabled の方が良い。
  isLoaded: boolean;
  // load 完了後、呼び出し元が永続化された currentThemeId 等を反映するために使う。
  // load の戻り値で渡すと App.tsx 側のフローが分かりやすい。
  load: () => Promise<AppSettings>;
  update: (patch: PartialAppSettings) => void;
}

let unsubscribeChanged: (() => void) | null = null;

// settings は永続化されるが、ウィンドウごとに「現在のテーマ ID」は独立して持つ
// （CLAUDE.md §3.2 / themeStore の独立設計）。settings の broadcast を受けても
// themeStore.currentThemeId は触らず、customThemes 等の共有部分だけが各ウィンドウに伝わる。
// settingsStore からは themeStore を import しない（循環参照回避）。起動時の
// テーマ反映は App.tsx が settingsStore.load() の戻り値を見て themeStore に当てる。
export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,

  load: async (): Promise<AppSettings> => {
    if (typeof window === "undefined" || !window.api?.settings) {
      // テスト環境などで window.api が存在しないケース
      set({ isLoaded: true });
      return get().settings;
    }
    const loaded = await window.api.settings.get();
    set({ settings: loaded, isLoaded: true });

    // ウィンドウ全体（自分含む）への broadcast を購読し、共有設定を最新に保つ。
    if (!unsubscribeChanged) {
      unsubscribeChanged = window.api.settings.onChanged((next) => {
        set({ settings: next });
      });
    }
    return loaded;
  },

  update: (patch: PartialAppSettings): void => {
    // 楽観的にローカルを更新（IPC から broadcast が返ってきたら同じ値で再 set される）
    const current = get().settings;
    const optimistic = applyOptimistic(current, patch);
    set({ settings: optimistic });

    // Settings からターミナル fontSize を変更したときは全ペインの揮発オーバーライド
    // (Cmd+= / Cmd+- で付いた fontSizeOverride) をクリアして、新しい設定値を即時反映する。
    // これをやらないと「Settings を動かしてもパネル番号だけ変わってターミナル本体は変わらない」
    // 現象が起きる（override が effectiveFontSize を握り続けるため）。
    if (
      patch.terminal &&
      typeof patch.terminal.fontSize === "number" &&
      patch.terminal.fontSize !== current.terminal.fontSize
    ) {
      useTerminalMetaStore.getState().clearAllFontSizeOverrides();
    }

    if (typeof window !== "undefined" && window.api?.settings) {
      void window.api.settings.update(patch);
    }
  },
}));

// ローカル楽観更新用の浅いマージ。サーバ側 mergeSettings と挙動を揃える。
// validateAppSettings をそのまま呼ぶと "version" 等の余計な処理が入るため、
// renderer 側ではフィールドの上書きだけ行う。
function applyOptimistic(
  base: AppSettings,
  patch: PartialAppSettings,
): AppSettings {
  const next: AppSettings = {
    ...base,
    theme: { ...base.theme },
    shortcuts: { ...base.shortcuts },
    window: { ...base.window },
    terminal: { ...base.terminal },
    editor: { ...base.editor },
    general: { ...base.general },
  };
  if (patch.theme) {
    if (typeof patch.theme.currentThemeId === "string") {
      next.theme.currentThemeId = patch.theme.currentThemeId;
    }
    if (Array.isArray(patch.theme.customThemes)) {
      next.theme.customThemes = patch.theme.customThemes;
    }
  }
  if (patch.shortcuts) {
    next.shortcuts = patch.shortcuts;
  }
  if (patch.window) {
    if (patch.window.opacity !== undefined) {
      next.window.opacity = patch.window.opacity;
    }
    if (patch.window.vibrancyEnabled !== undefined) {
      next.window.vibrancyEnabled = patch.window.vibrancyEnabled;
    }
  }
  if (patch.terminal) {
    next.terminal = { ...next.terminal, ...patch.terminal };
  }
  if (patch.editor) {
    next.editor = { ...next.editor, ...patch.editor };
  }
  if (patch.general) {
    next.general = { ...next.general, ...patch.general };
  }
  return next;
}

// セレクターフック
export const useShortcutBindings = (): Record<string, string | null> =>
  useSettingsStore((s) => s.settings.shortcuts);

export const useWindowSettings = (): AppSettings["window"] =>
  useSettingsStore((s) => s.settings.window);

export const useCustomThemes = (): AppSettings["theme"]["customThemes"] =>
  useSettingsStore((s) => s.settings.theme.customThemes);

export const useTerminalSettings = (): AppSettings["terminal"] =>
  useSettingsStore((s) => s.settings.terminal);

export const useEditorSettings = (): AppSettings["editor"] =>
  useSettingsStore((s) => s.settings.editor);

export const useGeneralSettings = (): AppSettings["general"] =>
  useSettingsStore((s) => s.settings.general);
