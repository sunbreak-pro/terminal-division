import { create } from "zustand";

export interface TerminalMeta {
  cwd: string | null;
  processName: string | null;
  shellName: string | null;
  // タブ集約時に「直近アクティブだったペイン」を選ぶための単調増加カウンタ
  lastActiveAt: number;
  // ペインがレイアウトに追加された順を保持（タブの並び順に使用）
  createdAt: number;
  // ペイン固有のフォントサイズ上書き（Cmd+= / Cmd+- / Cmd+0 で揮発的に変動）。
  // null = グローバル settings.terminal.fontSize に従う。session-persist 対象外。
  fontSizeOverride: number | null;
  // 手動 rename されたペインタイトル。null = CWD 由来の自動表示。
  customTitle: string | null;
}

interface TerminalMetaStore {
  metas: Map<string, TerminalMeta>;
  setCwd: (id: string, cwd: string) => void;
  setProcessName: (id: string, processName: string) => void;
  setShellName: (id: string, shellName: string) => void;
  initMeta: (id: string) => void;
  setFontSizeOverride: (id: string, value: number | null) => void;
  // 全ペインの fontSizeOverride を一括 null に戻す（Settings からの fontSize 変更時に使用）
  clearAllFontSizeOverrides: () => void;
  setCustomTitle: (id: string, value: string | null) => void;
  // 分割直後の新ペインに対し、init と cwd 設定を 1 回の set で行う。
  initLeafMeta: (id: string, cwd: string | null) => void;
  removeMeta: (id: string) => void;
  touchActive: (id: string) => void;
  // セッション復元時に各葉ペインの cwd を一括投入する。
  hydrateMetas: (entries: Array<[string, { cwd: string | null }]>) => void;
}

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
        fontSizeOverride: null,
        customTitle: null,
      });
      set({ metas });
    },

    initLeafMeta: (id, cwd) => {
      const metas = new Map(get().metas);
      if (metas.has(id)) return;
      const seq = nextSeq();
      metas.set(id, {
        cwd,
        processName: null,
        shellName: null,
        lastActiveAt: seq,
        createdAt: seq,
        fontSizeOverride: null,
        customTitle: null,
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
          createdAt: existing?.createdAt ?? seq,
          lastActiveAt: existing?.lastActiveAt ?? seq,
          fontSizeOverride: null,
          customTitle: null,
        });
      }
      set({ metas });
    },

    setFontSizeOverride: (id, value) =>
      updateMeta(id, { fontSizeOverride: value }),

    clearAllFontSizeOverrides: () => {
      const current = get().metas;
      let mutated = false;
      const next = new Map(current);
      current.forEach((meta, id) => {
        if (meta.fontSizeOverride !== null) {
          next.set(id, { ...meta, fontSizeOverride: null });
          mutated = true;
        }
      });
      if (mutated) {
        set({ metas: next });
      }
    },

    setCustomTitle: (id, value) => updateMeta(id, { customTitle: value }),
  };
});

// セレクター: 特定IDのメタデータのみ購読（不要な再レンダリングを防ぐ）
export function useTerminalMeta(id: string): TerminalMeta | undefined {
  return useTerminalMetaStore((s) => s.metas.get(id));
}
