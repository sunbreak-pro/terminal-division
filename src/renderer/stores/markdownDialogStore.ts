import { create } from "zustand";
import type { UnsavedReason } from "../components/UnsavedChangesModal";

// Markdown 関連モーダルの中央集約 store。
// App.tsx が購読してレンダリング、各所 (Sidebar / TerminalSubHeader / Cmd+W ハンドラ)
// からは showXxx() を呼ぶだけで良い構成にする。コールバックを state に持つのは
// 異色だが、prop drilling や Context 配線を避けてコード量を抑える狙い。

export interface OpenConfirmRequest {
  kind: "open-confirm";
  filePath: string;
  paneId: string;
  paneNumber: number;
  // モーダルで「はい」が押された時の処理 (ファイル読込 + openMarkdown)
  onConfirm: () => void;
}

export interface UnsavedRequest {
  kind: "unsaved";
  filePath: string;
  paneId: string;
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
