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

// ===== Terminal カスタマイズ =====

export type CursorStyle = "block" | "underline" | "bar";
export type BellStyle = "none" | "visual" | "sound";

export interface TerminalSettings {
  // フォントサイズ（px）。Cmd+= / Cmd+- は per-pane の揮発オーバーライドだが
  // この値は新規ペイン作成時のグローバルなデフォルトとして永続化される。
  fontSize: number;
  // CSS font-family。複数フォールバック可（,区切り）。
  fontFamily: string;
  // xterm の lineHeight。1.0〜2.0。
  lineHeight: number;
  // カーソル形状
  cursorStyle: CursorStyle;
  // カーソル点滅
  cursorBlink: boolean;
  // 履歴行数
  scrollback: number;
  // ベル動作
  bellStyle: BellStyle;
  // ダブルクリック単語選択時の区切り文字
  wordSeparator: string;
  // PTY 起動シェル。空文字列 = $SHELL に従う（既定）
  defaultShell: string;
  // 新規ウィンドウのデフォルト CWD。空文字列 = $HOME（既定）
  defaultCwd: string;
}

// ===== Markdown エディタ カスタマイズ =====

export interface EditorSettings {
  fontSize: number;
  fontFamily: string;
  // ソフトラップ（折り返し）
  softWrap: boolean;
}

// ===== Chat カスタマイズ =====

// Chat ペインの本文（メッセージバブル / 入力欄）に適用するフォントサイズ。
// Cmd+= / Cmd+- / Cmd+0 がアクティブペインの viewMode=chat 時に本値を更新する。
export interface ChatSettings {
  fontSize: number;
}

// ===== 一般 =====

export interface GeneralSettings {
  // 起動時にレイアウト + CWD を復元するか
  restoreSessionOnLaunch: boolean;
  // PTY が異常終了したときに macOS 通知を出すか
  ptyExitNotification: boolean;
  // アプリ全体（ウィンドウ）の表示倍率。webFrame.setZoomFactor(value) で適用。
  // ターミナル個別のフォントズーム (Cmd+= / Cmd+-) とは独立。
  appZoomFactor: number;
}

export interface AppSettings {
  version: typeof SETTINGS_VERSION;
  theme: ThemeSettings;
  shortcuts: ShortcutBindings;
  window: WindowSettings;
  terminal: TerminalSettings;
  editor: EditorSettings;
  chat: ChatSettings;
  general: GeneralSettings;
}

export const OPACITY_MIN = 0.5;
export const OPACITY_MAX = 1.0;

// クランプ範囲（UI / validate 双方で参照）
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;
export const LINE_HEIGHT_MIN = 1.0;
export const LINE_HEIGHT_MAX = 2.0;
export const SCROLLBACK_MIN = 1000;
export const SCROLLBACK_MAX = 100000;
export const EDITOR_FONT_SIZE_MIN = 10;
export const EDITOR_FONT_SIZE_MAX = 32;
export const CHAT_FONT_SIZE_MIN = 10;
export const CHAT_FONT_SIZE_MAX = 28;
// アプリ全体ズームの安全範囲。Electron の webFrame は 0.25-5 を許容するが
// UI が破綻しない実用域に限定する。
export const APP_ZOOM_MIN = 0.5;
export const APP_ZOOM_MAX = 2.0;
export const APP_ZOOM_STEP = 0.1;

// 既定値（freeze で書換ガード）
export const DEFAULT_TERMINAL_FONT_FAMILY =
  'Menlo, Monaco, "Courier New", monospace';
export const DEFAULT_EDITOR_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", "Helvetica Neue", Arial, sans-serif';
// xterm の wordSeparator 既定（空白 + よくある区切り記号）
export const DEFAULT_WORD_SEPARATOR = " ()[]{}',\"`";

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
  terminal: {
    fontSize: 13,
    fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
    lineHeight: 1.2,
    cursorStyle: "block",
    cursorBlink: true,
    scrollback: 10000,
    bellStyle: "none",
    wordSeparator: DEFAULT_WORD_SEPARATOR,
    defaultShell: "",
    defaultCwd: "",
  },
  editor: {
    fontSize: 13.5,
    fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
    softWrap: true,
  },
  chat: {
    fontSize: 13.5,
  },
  general: {
    restoreSessionOnLaunch: true,
    ptyExitNotification: false,
    appZoomFactor: 1.0,
  },
};

// 部分更新用のディープな Partial 型。renderer から「terminal.fontSize だけ更新」
// のような部分パッチを送れるようにする。
export type PartialAppSettings = {
  theme?: Partial<ThemeSettings>;
  shortcuts?: ShortcutBindings;
  window?: Partial<WindowSettings>;
  terminal?: Partial<TerminalSettings>;
  editor?: Partial<EditorSettings>;
  chat?: Partial<ChatSettings>;
  general?: Partial<GeneralSettings>;
};

function clampOpacity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.window.opacity;
  }
  if (value < OPACITY_MIN) return OPACITY_MIN;
  if (value > OPACITY_MAX) return OPACITY_MAX;
  return value;
}

export function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
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

function validateString(raw: unknown, fallback: string, maxLen = 1024): string {
  if (typeof raw !== "string") return fallback;
  if (raw.length > maxLen) return fallback;
  return raw;
}

function validateCursorStyle(raw: unknown): CursorStyle {
  if (raw === "block" || raw === "underline" || raw === "bar") return raw;
  return DEFAULT_SETTINGS.terminal.cursorStyle;
}

function validateBellStyle(raw: unknown): BellStyle {
  if (raw === "none" || raw === "visual" || raw === "sound") return raw;
  return DEFAULT_SETTINGS.terminal.bellStyle;
}

function validateTerminalSettings(raw: unknown): TerminalSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    fontSize: clampNumber(
      obj.fontSize,
      FONT_SIZE_MIN,
      FONT_SIZE_MAX,
      DEFAULT_SETTINGS.terminal.fontSize,
    ),
    fontFamily: validateString(
      obj.fontFamily,
      DEFAULT_SETTINGS.terminal.fontFamily,
      512,
    ),
    lineHeight: clampNumber(
      obj.lineHeight,
      LINE_HEIGHT_MIN,
      LINE_HEIGHT_MAX,
      DEFAULT_SETTINGS.terminal.lineHeight,
    ),
    cursorStyle: validateCursorStyle(obj.cursorStyle),
    cursorBlink:
      typeof obj.cursorBlink === "boolean"
        ? obj.cursorBlink
        : DEFAULT_SETTINGS.terminal.cursorBlink,
    scrollback: Math.floor(
      clampNumber(
        obj.scrollback,
        SCROLLBACK_MIN,
        SCROLLBACK_MAX,
        DEFAULT_SETTINGS.terminal.scrollback,
      ),
    ),
    bellStyle: validateBellStyle(obj.bellStyle),
    wordSeparator: validateString(
      obj.wordSeparator,
      DEFAULT_SETTINGS.terminal.wordSeparator,
      64,
    ),
    defaultShell: validateString(
      obj.defaultShell,
      DEFAULT_SETTINGS.terminal.defaultShell,
      512,
    ),
    defaultCwd: validateString(
      obj.defaultCwd,
      DEFAULT_SETTINGS.terminal.defaultCwd,
      1024,
    ),
  };
}

function validateEditorSettings(raw: unknown): EditorSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    fontSize: clampNumber(
      obj.fontSize,
      EDITOR_FONT_SIZE_MIN,
      EDITOR_FONT_SIZE_MAX,
      DEFAULT_SETTINGS.editor.fontSize,
    ),
    fontFamily: validateString(
      obj.fontFamily,
      DEFAULT_SETTINGS.editor.fontFamily,
      512,
    ),
    softWrap:
      typeof obj.softWrap === "boolean"
        ? obj.softWrap
        : DEFAULT_SETTINGS.editor.softWrap,
  };
}

function validateGeneralSettings(raw: unknown): GeneralSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    restoreSessionOnLaunch:
      typeof obj.restoreSessionOnLaunch === "boolean"
        ? obj.restoreSessionOnLaunch
        : DEFAULT_SETTINGS.general.restoreSessionOnLaunch,
    ptyExitNotification:
      typeof obj.ptyExitNotification === "boolean"
        ? obj.ptyExitNotification
        : DEFAULT_SETTINGS.general.ptyExitNotification,
    appZoomFactor: clampNumber(
      obj.appZoomFactor,
      APP_ZOOM_MIN,
      APP_ZOOM_MAX,
      DEFAULT_SETTINGS.general.appZoomFactor,
    ),
  };
}

function validateChatSettings(raw: unknown): ChatSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    fontSize: clampNumber(
      obj.fontSize,
      CHAT_FONT_SIZE_MIN,
      CHAT_FONT_SIZE_MAX,
      DEFAULT_SETTINGS.chat.fontSize,
    ),
  };
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
  const terminal = validateTerminalSettings(obj.terminal);
  const editor = validateEditorSettings(obj.editor);
  const chat = validateChatSettings(obj.chat);
  const general = validateGeneralSettings(obj.general);

  return {
    version: SETTINGS_VERSION,
    theme: { currentThemeId, customThemes },
    shortcuts,
    window,
    terminal,
    editor,
    chat,
    general,
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
    terminal: { ...base.terminal },
    editor: { ...base.editor },
    chat: { ...base.chat },
    general: { ...base.general },
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

  if (patch.terminal) {
    next.terminal = validateTerminalSettings({
      ...base.terminal,
      ...patch.terminal,
    });
  }

  if (patch.editor) {
    next.editor = validateEditorSettings({
      ...base.editor,
      ...patch.editor,
    });
  }

  if (patch.chat) {
    next.chat = validateChatSettings({
      ...base.chat,
      ...patch.chat,
    });
  }

  if (patch.general) {
    next.general = validateGeneralSettings({
      ...base.general,
      ...patch.general,
    });
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
    terminal: { ...DEFAULT_SETTINGS.terminal },
    editor: { ...DEFAULT_SETTINGS.editor },
    chat: { ...DEFAULT_SETTINGS.chat },
    general: { ...DEFAULT_SETTINGS.general },
  };
}
