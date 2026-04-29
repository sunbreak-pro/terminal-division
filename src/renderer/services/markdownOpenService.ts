// Markdown ファイルを「ペインで開く」操作の集約サービス。
// 発火元（Sidebar / Terminal リンク）に依存しない open フローを 1 箇所に集める。
//
// 設計方針:
//  - 「アクティブペイン CWD 配下のファイル」 → そのまま開く（確認ダイアログ無し）
//    ※ ターミナル発のリンクは「自分のペインの CWD 配下」を current とみなす
//  - 「外」 → 確認ダイアログを出し、既存ペイン or 新規ペイン作成 を選ばせる
//  - Sidebar からの起動は常にダイアログを出す（ユーザーが明示的に選びたいケース）

import { useTerminalStore } from "../stores/terminalStore";
import { useTerminalMetaStore } from "../stores/terminalMetaStore";
import { useMarkdownDialogStore } from "../stores/markdownDialogStore";
import * as markdownEditorRegistry from "./markdownEditorRegistry";
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
  useTerminalMetaStore
    .getState()
    .openMarkdown(paneId, filePath, result.content);
  useTerminalStore.getState().setActiveTerminal(paneId);
}

// 既存ペインを分割して新規ペインを作り、そこで MD を開く。
// 元ペインは splitTerminal の引数で指定（通常は activeTerminalId）。
// 分割不可（MAX_TERMINALS 到達など）の場合は toast を出して諦める。
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
// - currentPaneId: ダイアログのデフォルト選択ペイン
// - originatingPaneId: 「新規」が選ばれた際に分割の起点となるペイン
//   （Sidebar 起動時は currentPaneId と同じで OK）
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
  const showUnsaved = useMarkdownDialogStore.getState().showUnsaved;
  const dismiss = useMarkdownDialogStore.getState().dismiss;

  const performOpen = (chosen: PaneChoiceId): void => {
    dismiss();
    if (chosen === NEW_PANE_CHOICE) {
      void openMarkdownInNewPane(originatingPaneId, filePath);
    } else {
      void openMarkdownInPane(chosen, filePath);
    }
  };

  const showConfirm = (): void => {
    showOpenConfirm({
      filePath,
      availablePanes,
      defaultPaneId: currentPaneId,
      allowCreateNewPane: true,
      onConfirm: performOpen,
    });
  };

  // 選択ペインが dirty な MD を編集中なら、先に未保存警告を出す（既存挙動踏襲）
  const meta = useTerminalMetaStore.getState().metas.get(currentPaneId);
  if (meta && meta.viewMode === "md" && meta.mdDirty && meta.mdFilePath) {
    showUnsaved({
      filePath: meta.mdFilePath,
      paneId: currentPaneId,
      reason: "open-other",
      onSave: async () => {
        const api = markdownEditorRegistry.getApi(currentPaneId);
        const ok = api ? await api.save() : false;
        if (!ok) {
          showErrorToast("保存に失敗しました");
          return;
        }
        dismiss();
        showConfirm();
      },
      onDiscard: () => {
        dismiss();
        showConfirm();
      },
    });
    return;
  }
  showConfirm();
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
    // current 配下: 直接開く（dirty なら未保存警告）
    const showUnsaved = useMarkdownDialogStore.getState().showUnsaved;
    const dismiss = useMarkdownDialogStore.getState().dismiss;

    if (meta && meta.viewMode === "md" && meta.mdDirty && meta.mdFilePath) {
      showUnsaved({
        filePath: meta.mdFilePath,
        paneId: originatingPaneId,
        reason: "open-other",
        onSave: async () => {
          const api = markdownEditorRegistry.getApi(originatingPaneId);
          const ok = api ? await api.save() : false;
          if (!ok) {
            showErrorToast("保存に失敗しました");
            return;
          }
          dismiss();
          void openMarkdownInPane(originatingPaneId, resolvedAbsolutePath);
        },
        onDiscard: () => {
          dismiss();
          void openMarkdownInPane(originatingPaneId, resolvedAbsolutePath);
        },
      });
      return;
    }
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
