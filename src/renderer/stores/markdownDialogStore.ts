import { create } from "zustand";
import type { UnsavedReason } from "../components/UnsavedChangesModal";

// Markdown 関連モーダルの中央集約 store。
// 旧仕様の OpenConfirmRequest（ペイン選択）は廃止し、UnsavedRequest のみ残す。

export interface UnsavedRequest {
  kind: "unsaved";
  filePath: string;
  // 対象の MD タブ ID。markdownEditorRegistry 経由で save をトリガーするために使う。
  tabId: string;
  reason: UnsavedReason;
  onSave: () => void;
  onDiscard: () => void;
}

export type DialogRequest = UnsavedRequest;

interface MarkdownDialogStore {
  current: DialogRequest | null;
  showUnsaved: (req: Omit<UnsavedRequest, "kind">) => void;
  dismiss: () => void;
}

export const useMarkdownDialogStore = create<MarkdownDialogStore>((set) => ({
  current: null,
  showUnsaved: (req) => set({ current: { kind: "unsaved", ...req } }),
  dismiss: () => set({ current: null }),
}));
