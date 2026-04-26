// アプリ設定の SSOT。Main / Preload / Renderer のすべてが本ファイルを参照する。
// userData/settings.json に永続化される構造を定義し、検証ロジックを提供する。

import { validateTheme, type Theme } from "./theme-types";

export const SETTINGS_VERSION = 1 as const;

// ショートカット ID は registry 側で union literal として定義するが、
// shared 層では「文字列キー → キー文字列 or null」のマップとして扱う。
// null は「割り当てなし（無効化）」を意味する。
export type ShortcutBindings = Record<string, string | null>;

export interface WindowSettings {
  // ウィンドウ全体の不透明度。1.0 = 完全不透明、0.5 を下限とする。
  opacity: number;
  // すりガラス（vibrancy）有効化フラグ。切替には再起動が必要。
  vibrancyEnabled: boolean;
}

export interface ThemeSettings {
  currentThemeId: string;
  // ユーザー定義テーマ。組込プリセットとは別管理。
  customThemes: Theme[];
}

export interface AppSettings {
  version: typeof SETTINGS_VERSION;
  theme: ThemeSettings;
  shortcuts: ShortcutBindings;
  window: WindowSettings;
}

export const OPACITY_MIN = 0.5;
export const OPACITY_MAX = 1.0;

export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  theme: {
    currentThemeId: "dark",
    customThemes: [],
  },
  shortcuts: {},
  window: {
    opacity: 1.0,
    vibrancyEnabled: false,
  },
};

// 部分更新用のディープな Partial 型。renderer から「window.opacity だけ更新」
// のような部分パッチを送れるようにする。
export type PartialAppSettings = {
  theme?: Partial<ThemeSettings>;
  shortcuts?: ShortcutBindings;
  window?: Partial<WindowSettings>;
};

function clampOpacity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.window.opacity;
  }
  if (value < OPACITY_MIN) return OPACITY_MIN;
  if (value > OPACITY_MAX) return OPACITY_MAX;
  return value;
}

function validateShortcutBindings(raw: unknown): ShortcutBindings {
  if (!raw || typeof raw !== "object") return {};
  const result: ShortcutBindings = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id !== "string" || id.length === 0) continue;
    if (value === null) {
      result[id] = null;
      continue;
    }
    if (typeof value === "string" && value.length > 0 && value.length <= 64) {
      result[id] = value;
    }
    // それ以外は無視（破損したエントリを落とす）
  }
  return result;
}

function validateCustomThemes(raw: unknown): Theme[] {
  if (!Array.isArray(raw)) return [];
  const valid: Theme[] = [];
  for (const item of raw) {
    const theme = validateTheme(item);
    if (theme) valid.push(theme);
  }
  return valid;
}

// 設定全体を検証して、違反フィールドはデフォルトに置換した正規化済み設定を返す。
// セッション永続化（全否定）と異なり、設定はフィールド単位でフォールバックする。
// ユーザーの大半の設定を救えた方がストレスが少ないため。
export function validateAppSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== "object") {
    return cloneDefaults();
  }
  const obj = raw as Record<string, unknown>;

  if (obj.version !== SETTINGS_VERSION) {
    return cloneDefaults();
  }

  const themeRaw = (obj.theme ?? {}) as Record<string, unknown>;
  const currentThemeId =
    typeof themeRaw.currentThemeId === "string" &&
    themeRaw.currentThemeId.length > 0
      ? themeRaw.currentThemeId
      : DEFAULT_SETTINGS.theme.currentThemeId;
  const customThemes = validateCustomThemes(themeRaw.customThemes);

  const windowRaw = (obj.window ?? {}) as Record<string, unknown>;
  const window: WindowSettings = {
    opacity: clampOpacity(windowRaw.opacity),
    vibrancyEnabled: windowRaw.vibrancyEnabled === true,
  };

  const shortcuts = validateShortcutBindings(obj.shortcuts);

  return {
    version: SETTINGS_VERSION,
    theme: { currentThemeId, customThemes },
    shortcuts,
    window,
  };
}

// 部分パッチを既存設定にマージ。ネストオブジェクトはフィールド単位でマージ。
export function mergeSettings(
  base: AppSettings,
  patch: PartialAppSettings,
): AppSettings {
  const next: AppSettings = {
    version: SETTINGS_VERSION,
    theme: { ...base.theme },
    shortcuts: { ...base.shortcuts },
    window: { ...base.window },
  };

  if (patch.theme) {
    if (typeof patch.theme.currentThemeId === "string") {
      next.theme.currentThemeId = patch.theme.currentThemeId;
    }
    if (Array.isArray(patch.theme.customThemes)) {
      next.theme.customThemes = validateCustomThemes(patch.theme.customThemes);
    }
  }

  if (patch.shortcuts) {
    // shortcuts は完全置換（差分マージではなく丸ごと置き換える方が
    // 「クリア」「リセット」操作が表現しやすい）
    next.shortcuts = validateShortcutBindings(patch.shortcuts);
  }

  if (patch.window) {
    if (patch.window.opacity !== undefined) {
      next.window.opacity = clampOpacity(patch.window.opacity);
    }
    if (patch.window.vibrancyEnabled !== undefined) {
      next.window.vibrancyEnabled = patch.window.vibrancyEnabled === true;
    }
  }

  return next;
}

function cloneDefaults(): AppSettings {
  return {
    version: SETTINGS_VERSION,
    theme: {
      currentThemeId: DEFAULT_SETTINGS.theme.currentThemeId,
      customThemes: [],
    },
    shortcuts: {},
    window: { ...DEFAULT_SETTINGS.window },
  };
}
