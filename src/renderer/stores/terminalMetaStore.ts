import { create } from "zustand";

export type ViewMode = "cli" | "md";

export interface TerminalMeta {
  cwd: string | null;
  processName: string | null;
  shellName: string | null;
  // タブ集約時に「直近アクティブだったペイン」を選ぶための単調増加カウンタ
  lastActiveAt: number;
  // ペインがレイアウトに追加された順を保持（タブの並び順に使用）
  createdAt: number;
  // ペイン内の表示モード。MD 編集中も PTY は生存させ display:none で隠す。
  viewMode: ViewMode;
  // 編集中の Markdown ファイルパス。null = MD タブ未読込
  mdFilePath: string | null;
  // 最後に保存した内容（dirty 判定の基準）
  mdSavedContent: string | null;
  // エディタの現在内容と mdSavedContent の差分があるか
  mdDirty: boolean;
  // openMarkdown が呼ばれたタイミングのカウンタ。同一ファイルを再ロード
  // した場合に MarkdownEditor を remount するための key 構成要素。
  mdLoadedAt: number;
}

interface TerminalMetaStore {
  metas: Map<string, TerminalMeta>;
  setCwd: (id: string, cwd: string) => void;
  setProcessName: (id: string, processName: string) => void;
  setShellName: (id: string, shellName: string) => void;
  initMeta: (id: string) => void;
  // 分割直後の新ペインに対し、init と cwd 設定を 1 回の set で行う。
  // サブスクライバが「meta だけある / cwd だけある」中間状態を観測しないことを保証する。
  initLeafMeta: (id: string, cwd: string | null) => void;
  removeMeta: (id: string) => void;
  touchActive: (id: string) => void;
  // セッション復元時に各葉ペインの cwd を一括投入する。
  // initMeta の上書き禁止ガードを尊重しつつ、既存メタも cwd を上書きできる専用 action。
  hydrateMetas: (entries: Array<[string, { cwd: string | null }]>) => void;
  // ===== Markdown editor =====
  // ファイル読込後にペインへ MD コンテンツを紐付け、viewMode=md に切替
  openMarkdown: (id: string, filePath: string, content: string) => void;
  // viewMode のみ変更（CLI <-> MD タブ切替）
  setViewMode: (id: string, mode: ViewMode) => void;
  // エディタからの dirty 通知
  setMdDirty: (id: string, dirty: boolean) => void;
  // 保存成功時に savedContent を更新し dirty=false に戻す
  markMdSaved: (id: string, content: string) => void;
  // MD タブを閉じる（CLI に戻し、MD 関連フィールドをクリア）
  clearMarkdown: (id: string) => void;
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
        viewMode: "cli",
        mdFilePath: null,
        mdSavedContent: null,
        mdDirty: false,
        mdLoadedAt: 0,
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
        viewMode: "cli",
        mdFilePath: null,
        mdSavedContent: null,
        mdDirty: false,
        mdLoadedAt: 0,
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
          viewMode: "cli",
          mdFilePath: null,
          mdSavedContent: null,
          mdDirty: false,
          mdLoadedAt: 0,
        });
      }
      set({ metas });
    },

    openMarkdown: (id, filePath, content) =>
      updateMeta(id, {
        viewMode: "md",
        mdFilePath: filePath,
        mdSavedContent: content,
        mdDirty: false,
        mdLoadedAt: nextSeq(),
      }),

    setViewMode: (id, mode) => updateMeta(id, { viewMode: mode }),

    setMdDirty: (id, dirty) => updateMeta(id, { mdDirty: dirty }),

    markMdSaved: (id, content) =>
      updateMeta(id, { mdSavedContent: content, mdDirty: false }),

    clearMarkdown: (id) =>
      updateMeta(id, {
        viewMode: "cli",
        mdFilePath: null,
        mdSavedContent: null,
        mdDirty: false,
        mdLoadedAt: 0,
      }),
  };
});

// セレクター: 特定IDのメタデータのみ購読（不要な再レンダリングを防ぐ）
export function useTerminalMeta(id: string): TerminalMeta | undefined {
  return useTerminalMetaStore((s) => s.metas.get(id));
}
