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

export const useTerminalMetaStore = create<TerminalMetaStore>((set, get) => ({
  metas: new Map(),

  initMeta: (id) => {
    const metas = new Map(get().metas);
    metas.set(id, { cwd: null, processName: null, shellName: null });
    set({ metas });
  },

  setCwd: (id, cwd) => {
    const metas = new Map(get().metas);
    const existing = metas.get(id);
    if (existing) {
      metas.set(id, { ...existing, cwd });
      set({ metas });
    }
  },

  setProcessName: (id, processName) => {
    const metas = new Map(get().metas);
    const existing = metas.get(id);
    if (existing) {
      metas.set(id, { ...existing, processName });
      set({ metas });
    }
  },

  setShellName: (id, shellName) => {
    const metas = new Map(get().metas);
    const existing = metas.get(id);
    if (existing) {
      metas.set(id, { ...existing, shellName });
      set({ metas });
    }
  },

  removeMeta: (id) => {
    const metas = new Map(get().metas);
    metas.delete(id);
    set({ metas });
  },
}));

// セレクター: 特定IDのメタデータのみ購読（不要な再レンダリングを防ぐ）
export function useTerminalMeta(id: string): TerminalMeta | undefined {
  return useTerminalMetaStore((s) => s.metas.get(id));
}
