// MD タブピッカー用に「現在 watch 中の全タブの CWD 配下を再帰検索して .md を集める」関数。
//
// 仕様（ユーザー回答 2）:
//  - 最大 50 件
//  - 検索フィールドあり（呼び出し側で query を渡してフィルタ）
//  - 横スクロール対応は UI 側

import type { TerminalMeta } from "../stores/terminalMetaStore";

export interface MdFileEntry {
  path: string;
  // 表示用のファイル名（path の末尾セグメント）
  name: string;
}

const MAX_RESULTS = 50;

// MD 拡張子判定（lowercase 比較）
function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function basename(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/**
 * metas から重複排除した CWD 一覧を返す。各 CWD で再帰検索を行うベースになる。
 */
function collectUniqueCwds(metas: Map<string, TerminalMeta>): string[] {
  const out = new Set<string>();
  for (const m of metas.values()) {
    if (m.cwd) out.add(m.cwd);
  }
  return Array.from(out);
}

/**
 * 全 watch 中ペインの CWD 配下を再帰検索して .md を集める。
 * query が指定されていればファイル名（小文字比較）でフィルタ。
 * 結果は path の重複排除 + 最大 50 件。
 *
 * fs:searchTree は file 検索なので、MD だけ抽出する。
 */
export async function listMarkdownFilesAcrossPanes(
  metas: Map<string, TerminalMeta>,
  query: string,
): Promise<{ entries: MdFileEntry[]; truncated: boolean }> {
  const cwds = collectUniqueCwds(metas);
  if (cwds.length === 0) {
    return { entries: [], truncated: false };
  }
  const seen = new Set<string>();
  const out: MdFileEntry[] = [];
  let truncated = false;
  // searchTree は内部で複雑な再帰なので、各 CWD で並列に投げる（最大 8 並列）
  const results = await Promise.all(
    cwds.map((cwd) =>
      window.api.fs.searchTree(cwd, query.length > 0 ? query : ".md"),
    ),
  );
  for (const result of results) {
    if (!result.ok) continue;
    if (result.truncated) truncated = true;
    for (const e of result.entries) {
      if (e.isDirectory) continue;
      if (!isMarkdown(e.name)) continue;
      if (seen.has(e.path)) continue;
      // query があれば lowercase でファイル名フィルタ
      if (query.length > 0) {
        const name = basename(e.path).toLowerCase();
        if (!name.includes(query.toLowerCase())) continue;
      }
      seen.add(e.path);
      out.push({ path: e.path, name: basename(e.path) });
      if (out.length >= MAX_RESULTS) {
        truncated = true;
        return { entries: out, truncated };
      }
    }
  }
  return { entries: out, truncated };
}
