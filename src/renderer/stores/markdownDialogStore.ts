import { create } from "zustand";
import type { UnsavedReason } from "../components/UnsavedChangesModal";

// Markdown 関連モーダルの中央集約 store。
// App.tsx が購読してレンダリング、各所 (Sidebar / TerminalSubHeader / Cmd+W ハンドラ)
// からは showXxx() を呼ぶだけで良い構成にする。コールバックを state に持つのは
// 異色だが、prop drilling や Context 配線を避けてコード量を抑える狙い。

export interface PaneChoice {
  paneId: string;
  paneNumber: number;
}

export interface OpenConfirmRequest {
  kind: "open-confirm";
  filePath: string;
  // ダイアログで選択可能なペイン一覧（ペイン番号順）
  availablePanes: PaneChoice[];
  // ダイアログ初期選択ペイン
  defaultPaneId: string;
  // 「新規パネルを作成して開く」を選択肢に出すか。
  // true のとき onConfirm に "__new__" sentinel が渡される（NEW_PANE_CHOICE）。
  // markdownOpenService 側で sentinel を解釈して splitTerminal を実行する。
  allowCreateNewPane?: boolean;
  // モーダルで「はい」が押された時の処理 (ファイル読込 + openMarkdown)。
  // ユーザーがダイアログ内で変更したペイン ID、または "__new__" を受け取る。
  onConfirm: (paneId: string) => void;
}

export interface UnsavedRequest {
  kind: "unsaved";
  filePath: string;
  paneId: string;
  // 対象の MD タブ ID。複数 MD タブ環境で「どのタブの dirty に対する警告か」を
  // markdownEditorRegistry 経由で特定するために必要。
  tabId: string;
  reason: UnsavedReason;
  onSave: () => void;
  onDiscard: () => void;
}

export type DialogRequest = OpenConfirmRequest | UnsavedRequest;

interface MarkdownDialogStore {
  current: DialogRequest | null;
  showOpenConfirm: (req: Omit<OpenConfirmRequest, "kind">) => void;
  showUnsaved: (req: Omit<UnsavedRequest, "kind">) => void;
  dismiss: () => void;
}

export const useMarkdownDialogStore = create<MarkdownDialogStore>((set) => ({
  current: null,
  showOpenConfirm: (req) => set({ current: { kind: "open-confirm", ...req } }),
  showUnsaved: (req) => set({ current: { kind: "unsaved", ...req } }),
  dismiss: () => set({ current: null }),
}));
