// Markdown 編集対象として認識する拡張子の判定。
// .md / .markdown のみ対応（case-insensitive）。
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

export function isMarkdownPath(filePath: string): boolean {
  if (typeof filePath !== "string" || filePath.length === 0) return false;
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot < 0) return false;
  const ext = filePath.slice(lastDot).toLowerCase();
  return MARKDOWN_EXTENSIONS.has(ext);
}

// パスの末尾セグメントをファイル名として取り出す（モーダル/タブ表示用）。
export function getFileName(filePath: string): string {
  if (typeof filePath !== "string" || filePath.length === 0) return "";
  const sep = filePath.lastIndexOf("/");
  return sep < 0 ? filePath : filePath.slice(sep + 1);
}
