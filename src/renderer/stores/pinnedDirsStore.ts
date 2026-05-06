// Sidebar の「ペインに紐付かない追加ツリー」のピン留めパス一覧を保持する store。
// Main 側の永続化 (pinned-directories.json) と双方向同期する:
//   - 起動時 init() で pinnedDirs:get からロード
//   - add / remove は楽観的に local state を更新し、IPC で永続化を反映
//   - IPC 失敗時は local state を rollback
//
// 並び順: 追加された順。ユーザが明示的に ↑↓ 操作する UI は今のところ無い。

import { create } from "zustand";

interface PinnedDirsState {
  paths: string[];
  initialized: boolean;
  init: () => Promise<void>;
  add: (dirPath: string) => Promise<boolean>;
  remove: (dirPath: string) => Promise<boolean>;
}

export const usePinnedDirsStore = create<PinnedDirsState>((set, get) => ({
  paths: [],
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    try {
      const paths = await window.api.pinnedDirs.get();
      set({ paths: Array.isArray(paths) ? paths : [], initialized: true });
    } catch {
      set({ paths: [], initialized: true });
    }
  },

  add: async (dirPath) => {
    if (!dirPath || get().paths.includes(dirPath)) return false;
    const prev = get().paths;
    set({ paths: [...prev, dirPath] });
    try {
      const ok = await window.api.pinnedDirs.add(dirPath);
      if (!ok) {
        set({ paths: prev });
        return false;
      }
      return true;
    } catch {
      set({ paths: prev });
      return false;
    }
  },

  remove: async (dirPath) => {
    const prev = get().paths;
    if (!prev.includes(dirPath)) return false;
    set({ paths: prev.filter((p) => p !== dirPath) });
    try {
      const ok = await window.api.pinnedDirs.remove(dirPath);
      if (!ok) {
        set({ paths: prev });
        return false;
      }
      return true;
    } catch {
      set({ paths: prev });
      return false;
    }
  },
}));
