// Markdown ファイルを「右サイドバーで開く」操作の集約サービス。
// 旧仕様の「ペインを選んで開く / 新規ペイン作成 / CWD 内外判定」は廃止し、
// 単純に「右サイドバーに新しいタブとして開いて自動オープンする」だけに簡素化した。

import { isMarkdownPath } from "../utils/markdownFile";
import { useMarkdownTabsStore } from "../stores/markdownTabsStore";
import { useRightSidebarStore } from "../stores/rightSidebarStore";
import { showErrorToast } from "../components/Sidebar/ErrorToast";

// 内部実装: ファイル読込 → openMarkdown → サイドバー自動オープン。
async function loadAndOpen(filePath: string): Promise<void> {
  const result = await window.api.fs.readFile(filePath);
  if (!result.ok) {
    showErrorToast(`ファイル読込に失敗しました: ${result.error}`);
    return;
  }
  const opened = useMarkdownTabsStore
    .getState()
    .openMarkdown(filePath, result.content);
  if (!opened.ok) {
    if (opened.reason === "limit") {
      showErrorToast(
        "開ける Markdown タブは最大 8 件です。タブを閉じてから開いてください。",
      );
    } else {
      showErrorToast("Markdown を開けませんでした");
    }
    return;
  }
  // 自動でサイドバーを開く
  useRightSidebarStore.getState().setOpen(true);
}

/**
 * 右サイドバーで Markdown を開く共通エントリポイント。
 * Sidebar の「編集する」/シングルクリック、ターミナル内リンク、ファイル選択ダイアログ等から呼ばれる。
 */
export async function openMarkdownInRightSidebar(
  filePath: string,
): Promise<void> {
  if (!isMarkdownPath(filePath)) return;
  await loadAndOpen(filePath);
}

// 旧 API の互換シム（呼び出し側を簡素化していくが、まず動作させるため残す）。
// 第二引数の defaultPaneId / originatingPaneId は無視する。
export function requestEditMarkdownFromSidebar(filePath: string): void {
  void openMarkdownInRightSidebar(filePath);
}

export function requestEditMarkdownFromTerminal(
  resolvedAbsolutePath: string,
): void {
  void openMarkdownInRightSidebar(resolvedAbsolutePath);
}
