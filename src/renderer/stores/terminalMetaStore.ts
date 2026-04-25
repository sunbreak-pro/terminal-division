import { create } from "zustand";

export interface TerminalMeta {
  cwd: string | null;
  processName: string | null;
  shellName: string | null;
  // タブ集約時に「直近アクティブだったペイン」を選ぶための単調増加カウンタ
  lastActiveAt: number;
  // ペインがレイアウトに追加された順を保持（タブの並び順に使用）
  createdAt: number;
}

interface TerminalMetaStore {
  metas: Map<string, TerminalMeta>;
  setCwd: (id: string, cwd: string) => void;
  setProcessName: (id: string, processName: string) => void;
  setShellName: (id: string, shellName: string) => void;
  initMeta: (id: string) => void;
  removeMeta: (id: string) => void;
  touchActive: (id: string) => void;
  // セッション復元時に各葉ペインの cwd を一括投入する。
  // initMeta の上書き禁止ガードを尊重しつつ、既存メタも cwd を上書きできる専用 action。
  hydrateMetas: (entries: Array<[string, { cwd: string | null }]>) => void;
}

// セッション内で単調増加するカウンタ（initMeta / touchActive の両方で使用）
let monotonicCounter = 0;
const nextSeq = (): number => ++monotonicCounter;

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
      const seq = nextSeq();
      metas.set(id, {
        cwd: null,
        processName: null,
        shellName: null,
        lastActiveAt: seq,
        createdAt: seq,
      });
      set({ metas });
    },

    setCwd: (id, cwd) => updateMeta(id, { cwd }),
    setProcessName: (id, processName) => updateMeta(id, { processName }),
    setShellName: (id, shellName) => updateMeta(id, { shellName }),

    touchActive: (id) => updateMeta(id, { lastActiveAt: nextSeq() }),

    removeMeta: (id) => {
      const metas = new Map(get().metas);
      metas.delete(id);
      set({ metas });
    },

    hydrateMetas: (entries) => {
      const metas = new Map(get().metas);
      for (const [id, { cwd }] of entries) {
        const seq = nextSeq();
        const existing = metas.get(id);
        metas.set(id, {
          cwd,
          processName: existing?.processName ?? null,
          shellName: existing?.shellName ?? null,
          // 復元時は順序が決まらないため、エントリ順に createdAt を割り振る
          createdAt: existing?.createdAt ?? seq,
          lastActiveAt: existing?.lastActiveAt ?? seq,
        });
      }
      set({ metas });
    },
  };
});

// セレクター: 特定IDのメタデータのみ購読（不要な再レンダリングを防ぐ）
export function useTerminalMeta(id: string): TerminalMeta | undefined {
  return useTerminalMetaStore((s) => s.metas.get(id));
}
