// テーマ型定義の SSOT。Main / Preload / Renderer のすべてが本ファイルを参照する。
// Node API / Electron 依存は持たないため、どのプロセスからも import 可能。
// プリセット値や themeConfig は renderer/styles/theme.ts に置き、本ファイルは型のみ。

export interface XtermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface AppColors {
  background: string;
  headerBackground: string;
  terminalBackground: string;
  text: string;
  textSecondary: string;
  accent: string;
  activeTerminal: string;
  border: string;
  borderActive: string;
  buttonHover: string;
  danger: string;
}

export interface Theme {
  id: string;
  name: string;
  colors: AppColors;
  xterm: XtermTheme;
}

// XtermTheme の全キー（バリデーションで使用）
export const XTERM_THEME_KEYS: readonly (keyof XtermTheme)[] = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "selectionForeground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

// AppColors の全キー
export const APP_COLOR_KEYS: readonly (keyof AppColors)[] = [
  "background",
  "headerBackground",
  "terminalBackground",
  "text",
  "textSecondary",
  "accent",
  "activeTerminal",
  "border",
  "borderActive",
  "buttonHover",
  "danger",
];

// HEX カラー形式（#rgb / #rrggbb / #rrggbbaa）の判定。
// 大文字小文字どちらも許容。RGBA は xterm.js が許容するので含める。
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

// Theme の構造検証。1 つでも違反したら null。
export function validateTheme(raw: unknown): Theme | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || obj.id.length === 0) return null;
  if (typeof obj.name !== "string" || obj.name.length === 0) return null;

  const colors = obj.colors;
  if (!colors || typeof colors !== "object") return null;
  const colorsObj = colors as Record<string, unknown>;
  for (const key of APP_COLOR_KEYS) {
    if (!isHexColor(colorsObj[key])) return null;
  }

  const xterm = obj.xterm;
  if (!xterm || typeof xterm !== "object") return null;
  const xtermObj = xterm as Record<string, unknown>;
  for (const key of XTERM_THEME_KEYS) {
    if (!isHexColor(xtermObj[key])) return null;
  }

  return raw as Theme;
}
