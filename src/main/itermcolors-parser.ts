// .itermcolors ファイル（XML plist）を Theme に変換する。
// 外部ライブラリを避けるため、必要最小限の plist 構造のみを正規表現でパース。
// サポート対象: <dict> 内の <key>...</key><dict>...</dict> ペアと、
// 内側 dict 中の Red/Green/Blue Component (<real>) のみ。
// それ以外（Alpha Component / Color Space / バイナリ plist）は無視する。

import type { AppColors, Theme, XtermTheme } from "../shared/theme-types";

// .itermcolors の Ansi N Color → XtermTheme のキーへの対応表
const ANSI_TO_KEY: Record<string, keyof XtermTheme> = {
  "Ansi 0 Color": "black",
  "Ansi 1 Color": "red",
  "Ansi 2 Color": "green",
  "Ansi 3 Color": "yellow",
  "Ansi 4 Color": "blue",
  "Ansi 5 Color": "magenta",
  "Ansi 6 Color": "cyan",
  "Ansi 7 Color": "white",
  "Ansi 8 Color": "brightBlack",
  "Ansi 9 Color": "brightRed",
  "Ansi 10 Color": "brightGreen",
  "Ansi 11 Color": "brightYellow",
  "Ansi 12 Color": "brightBlue",
  "Ansi 13 Color": "brightMagenta",
  "Ansi 14 Color": "brightCyan",
  "Ansi 15 Color": "brightWhite",
  "Background Color": "background",
  "Foreground Color": "foreground",
  "Cursor Color": "cursor",
  "Cursor Text Color": "cursorAccent",
  "Selection Color": "selectionBackground",
  "Selected Text Color": "selectionForeground",
};

interface RGB {
  r: number;
  g: number;
  b: number;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function rgbToHex({ r, g, b }: RGB): string {
  const to2 = (n: number) =>
    Math.round(clamp01(n) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

// <key>Foo</key><dict>...</dict> の組を上から順に取り出す。
// ネストした dict には対応しないが、.itermcolors は 2 段階固定なので問題ない。
function extractDictEntries(xml: string): Map<string, string> {
  const result = new Map<string, string>();
  // 外側 <plist><dict> の中身だけに絞る（簡易的に最初の <dict> を入口とみなす）
  const plistDictMatch = xml.match(
    /<plist[^>]*>\s*<dict>([\s\S]*)<\/dict>\s*<\/plist>/,
  );
  const body = plistDictMatch ? plistDictMatch[1] : xml;

  // <key>...</key> の出現位置をすべて拾い、その直後の <dict>...</dict> を取り出す
  const keyRe = /<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(body)) !== null) {
    result.set(m[1].trim(), m[2]);
  }
  return result;
}

function parseRGB(innerXml: string): RGB | null {
  // <key>Red Component</key><real>0.123</real> パターン
  const pickReal = (label: string): number | null => {
    const re = new RegExp(
      `<key>\\s*${label}\\s*<\\/key>\\s*<real>([^<]+)<\\/real>`,
    );
    const match = innerXml.match(re);
    if (!match) return null;
    const v = parseFloat(match[1]);
    return Number.isFinite(v) ? v : null;
  };
  const r = pickReal("Red Component");
  const g = pickReal("Green Component");
  const b = pickReal("Blue Component");
  if (r === null || g === null || b === null) return null;
  return { r, g, b };
}

// 既存の Theme をベースに、.itermcolors で取れた色を上書きする。
// .itermcolors には AppColors 相当の情報がないため、それは base から流用。
function buildXtermTheme(
  entries: Map<string, string>,
  base: XtermTheme,
): XtermTheme {
  const next: XtermTheme = { ...base };
  for (const [key, inner] of entries) {
    const themeKey = ANSI_TO_KEY[key];
    if (!themeKey) continue;
    const rgb = parseRGB(inner);
    if (rgb) {
      next[themeKey] = rgbToHex(rgb);
    }
  }
  return next;
}

// .itermcolors の本体パース。base には現在の組込テーマを渡し、
// AppColors 部分は base から流用、xterm 部分のみ上書きする。
export function parseItermColors(
  xml: string,
  fileName: string,
  base: { id: string; name: string; colors: AppColors; xterm: XtermTheme },
): Theme | null {
  if (typeof xml !== "string" || xml.length === 0) return null;
  // バイナリ plist（bplist00）は対応外。ヘッダで判定。
  if (xml.startsWith("bplist")) return null;

  let entries: Map<string, string>;
  try {
    entries = extractDictEntries(xml);
  } catch {
    return null;
  }
  if (entries.size === 0) return null;

  const xtermTheme = buildXtermTheme(entries, base.xterm);

  // ファイル名から拡張子を除去して name に使う
  const displayName = fileName.replace(/\.itermcolors$/i, "");
  // id の重複は呼び出し側で解決する想定。ここではサフィックスを付けない。
  const id = `custom-${Date.now()}`;

  return {
    id,
    name: displayName.length > 0 ? displayName : "Imported Theme",
    colors: { ...base.colors },
    xterm: xtermTheme,
  };
}
