// テーマ駆動 UI で使う色操作ヘルパ。
// CodeMirror テーマ や inline style で alpha 付き色 / 輝度判定が必要な場面で利用する。

// 16進カラー (#rrggbb) に 0-1 の alpha を 8bit hex として付与する。
// 短縮形 (#rgb) や rgb()/hsl() などの形式は対象外（そのまま返す）。
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${clean}${a}`;
}

// 16進カラー (#rrggbb) の輝度から light テーマかどうかを判定する。
// 加重輝度（sRGB 簡易版）が 0.5 を超えたら light とみなす。
// 対応外フォーマット（#rgb, rgba(...) など）は false を返す。
export function isLightBackground(hex: string): boolean {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return false;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return false;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
}
