import { create } from "zustand";

export interface TerminalMeta {
  cwd: string | null;
  processName: string | null;
  shellName: string | null;
}

interface TerminalMetaStore {
  metas: Map<string, TerminalMeta>;
  setCwd: (id: string, cwd: string) => void;
  setProcessName: (id: string, processName: string) => void;
  setShellName: (id: string, shellName: string) => void;
  initMeta: (id: string) => void;
  removeMeta: (id: string) => void;
}

export const useTerminalMetaStore = create<TerminalMetaStore>((set, get) => {
  const updateMeta = (id: string, updates: Partial<TerminalMeta>): void => {
    const metas = new Map(get().metas);
    const existing = metas.get(id);
    if (existing) {
      metas.set(id, { ...existing, ...updates });
      set({ metas });
    }
  };

  return {
    metas: new Map(),

    initMeta: (id) => {
      const metas = new Map(get().metas);
      // 既にメタが存在する場合は上書きしない（分割時のCWD事前設定を保持するため）
      if (metas.has(id)) return;
      metas.set(id, { cwd: null, processName: null, shellName: null });
      set({ metas });
    },

    setCwd: (id, cwd) => updateMeta(id, { cwd }),
    setProcessName: (id, processName) => updateMeta(id, { processName }),
    setShellName: (id, shellName) => updateMeta(id, { shellName }),

    removeMeta: (id) => {
      const metas = new Map(get().metas);
      metas.delete(id);
      set({ metas });
    },
  };
});

// セレクター: 特定IDのメタデータのみ購読（不要な再レンダリングを防ぐ）
export function useTerminalMeta(id: string): TerminalMeta | undefined {
  return useTerminalMetaStore((s) => s.metas.get(id));
}
