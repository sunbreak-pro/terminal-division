// Markdown ファイルを「ペインで開く」操作の集約サービス。
// 発火元（Sidebar / Terminal リンク）に依存しない open フローを 1 箇所に集める。
//
// 設計方針（複数 MD タブ対応版）:
//  - 「アクティブペイン CWD 配下のファイル」 → そのまま開く（確認ダイアログ無し）
//    ※ ターミナル発のリンクは「自分のペインの CWD 配下」を current とみなす
//  - 「外」 → 確認ダイアログを出し、既存ペイン or 新規ペイン作成 を選ばせる
//  - Sidebar からの起動は常にダイアログを出す（ユーザーが明示的に選びたいケース）
//  - openMarkdown は同 path のタブがあれば既存をアクティブ化、無ければ新タブ追加。
//    タブ上限（MD_TABS_MAX = 8）到達時は toast で通知して諦める。
//  - 旧仕様の「dirty な MD を別ファイルで上書き」というシナリオは無くなった
//    （タブ追加で済むため）。dirty 警告は TerminalSubHeader 側のタブ close で扱う。

import { useTerminalStore } from "../stores/terminalStore";
import { useTerminalMetaStore } from "../stores/terminalMetaStore";
import { useMarkdownDialogStore } from "../stores/markdownDialogStore";
import { collectPaneIdsInOrder } from "../utils/layoutUtils";
import { isMarkdownPath } from "../utils/markdownFile";
import { isInsideCwd } from "../utils/markdownPath";
import { showErrorToast } from "../components/Sidebar/ErrorToast";

// 「新規ペイン作成」を表す sentinel。OpenMarkdownModal の onConfirm に渡される。
export const NEW_PANE_CHOICE = "__new__" as const;
export type PaneChoiceId = string;

// 指定ペインで Markdown を開く（ファイル読込 → openMarkdown → アクティブ化）。
// 失敗時は toast を出して終了。サービス内部からのみ呼ばれる。
async function openMarkdownInPane(
  paneId: string,
  filePath: string,
): Promise<void> {
  const result = await window.api.fs.readFile(filePath);
  if (!result.ok) {
    showErrorToast(`ファイル読込に失敗しました: ${result.error}`);
    return;
  }
  const opened = useTerminalMetaStore
    .getState()
    .openMarkdown(paneId, filePath, result.content);
  if (!opened.ok) {
    if (opened.reason === "limit") {
      showErrorToast(
        "このペインで開ける Markdown タブは最大 8 件です。タブを閉じてから開いてください。",
      );
    } else {
      showErrorToast("Markdown を開けませんでした");
    }
    return;
  }
  useTerminalStore.getState().setActiveTerminal(paneId);
}

// 既存ペインを分割して新規ペインを作り、そこで MD を開く。
async function openMarkdownInNewPane(
  basePaneId: string,
  filePath: string,
): Promise<void> {
  const store = useTerminalStore.getState();
  if (!store.canSplit()) {
    showErrorToast("これ以上ペインを増やせません（最大 6）");
    return;
  }
  const ok = store.splitTerminal(basePaneId, "horizontal");
  if (!ok) {
    showErrorToast("ペインの分割に失敗しました");
    return;
  }
  // splitTerminal は activeTerminalId を新ペインに設定する（terminalStore.ts:108）
  const newPaneId = useTerminalStore.getState().activeTerminalId;
  if (!newPaneId) {
    showErrorToast("新規ペインの取得に失敗しました");
    return;
  }
  await openMarkdownInPane(newPaneId, filePath);
}

// ダイアログ経由で Markdown を開く共通フロー。
// 複数 MD タブ環境では「現ペインの dirty な MD」概念が無くなったため、ダイアログを
// そのまま出すだけに簡素化される。
function showOpenDialog(args: {
  filePath: string;
  currentPaneId: string;
  originatingPaneId: string;
}): void {
  const { filePath, currentPaneId, originatingPaneId } = args;
  const { rootId, nodes } = useTerminalStore.getState();
  const orderedIds = rootId ? collectPaneIdsInOrder(rootId, nodes) : [];
  const availablePanes = orderedIds.map((paneId, idx) => ({
    paneId,
    paneNumber: idx + 1,
  }));

  const showOpenConfirm = useMarkdownDialogStore.getState().showOpenConfirm;
  const dismiss = useMarkdownDialogStore.getState().dismiss;

  const performOpen = (chosen: PaneChoiceId): void => {
    dismiss();
    if (chosen === NEW_PANE_CHOICE) {
      void openMarkdownInNewPane(originatingPaneId, filePath);
    } else {
      void openMarkdownInPane(chosen, filePath);
    }
  };

  showOpenConfirm({
    filePath,
    availablePanes,
    defaultPaneId: currentPaneId,
    allowCreateNewPane: true,
    onConfirm: performOpen,
  });
}

/**
 * Sidebar / 外部からの「Markdown を編集する」要求。常にダイアログを出す。
 * defaultPaneId は通常 activeTerminalId（呼び出し側で解決済みのもの）。
 */
export function requestEditMarkdownFromSidebar(
  filePath: string,
  defaultPaneId: string,
): void {
  if (!isMarkdownPath(filePath)) return;
  showOpenDialog({
    filePath,
    currentPaneId: defaultPaneId,
    originatingPaneId: defaultPaneId,
  });
}

/**
 * ターミナル内のリンククリックからの「Markdown を編集する」要求。
 *  - resolvedPath が originating ペインの CWD 配下なら、そのペインで直接開く
 *  - 配下でないなら確認ダイアログを出す
 *  - cwd 取得不能ならフォールバックで常にダイアログ
 */
export function requestEditMarkdownFromTerminal(
  resolvedAbsolutePath: string,
  originatingPaneId: string,
): void {
  if (!isMarkdownPath(resolvedAbsolutePath)) return;
  const meta = useTerminalMetaStore.getState().metas.get(originatingPaneId);
  const cwd = meta?.cwd ?? null;

  if (cwd && isInsideCwd(resolvedAbsolutePath, cwd)) {
    // current 配下: 直接開く（複数タブ環境では既存タブを尊重 / 新タブ追加）
    void openMarkdownInPane(originatingPaneId, resolvedAbsolutePath);
    return;
  }

  // CWD 外: 確認ダイアログ（新規ペイン作成オプション付き）
  showOpenDialog({
    filePath: resolvedAbsolutePath,
    currentPaneId: originatingPaneId,
    originatingPaneId,
  });
}

/**
 * 既に開かれている MD タブを集約して MdTabPickerDropdown 等から呼ぶための直接 API。
 * （+ ボタンのドロップダウン経由のオープンに使用）
 */
export async function openMarkdownDirect(
  paneId: string,
  filePath: string,
): Promise<void> {
  if (!isMarkdownPath(filePath)) return;
  await openMarkdownInPane(paneId, filePath);
}
