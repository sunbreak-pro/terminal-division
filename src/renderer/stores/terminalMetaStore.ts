import { create } from "zustand";

export type ViewMode = "cli" | "md" | "chat";

// 1 ペインで開ける MD タブの最大数。仕様で確定済み（ユーザー回答 4）。
export const MD_TABS_MAX = 8;

export interface MdTab {
  id: string;
  filePath: string;
  // 最後に保存したファイル内容（dirty 判定の基準）
  savedContent: string;
  // エディタの現在内容と savedContent の差分があるか
  dirty: boolean;
  // openMarkdown で再ロードされたタイミングのカウンタ（同一ファイル再オープン時の
  // MarkdownEditor remount key 構成要素）
  loadedAt: number;
}

export interface TerminalMeta {
  cwd: string | null;
  processName: string | null;
  shellName: string | null;
  // タブ集約時に「直近アクティブだったペイン」を選ぶための単調増加カウンタ
  lastActiveAt: number;
  // ペインがレイアウトに追加された順を保持（タブの並び順に使用）
  createdAt: number;
  // ペイン内の表示モード。MD/Chat 編集中も PTY は生存させ display:none で隠す。
  viewMode: ViewMode;
  // 開かれている MD タブ群（最大 MD_TABS_MAX = 8）。viewMode=md のとき activeMdTabId のタブを表示する。
  mdTabs: MdTab[];
  // 現在表示中の MD タブ ID。mdTabs が空なら null。
  activeMdTabId: string | null;
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
  // サブスクライバが「meta だけある / cwd だけある」中間状態を観測しないことを保証する。
  initLeafMeta: (id: string, cwd: string | null) => void;
  removeMeta: (id: string) => void;
  touchActive: (id: string) => void;
  // セッション復元時に各葉ペインの cwd / mdTabs を一括投入する。
  // initMeta の上書き禁止ガードを尊重しつつ、既存メタも cwd / mdTabs を上書きできる専用 action。
  hydrateMetas: (
    entries: Array<[string, { cwd: string | null; mdTabFilePaths?: string[] }]>,
  ) => void;
  // ===== Markdown editor (multi-tab) =====
  // 新規ファイルを開く / 既に開かれていればそのタブをアクティブ化する。
  // 戻り値: 成功時は tabId、上限到達時は { ok:false, reason:"limit" }
  openMarkdown: (
    id: string,
    filePath: string,
    content: string,
  ) =>
    | { ok: true; tabId: string; existed: boolean }
    | { ok: false; reason: "limit" };
  // viewMode 変更（CLI <-> MD <-> Chat タブ切替）
  setViewMode: (id: string, mode: ViewMode) => void;
  // アクティブ MD タブ変更
  setActiveMdTab: (id: string, tabId: string | null) => void;
  // 1 つの MD タブを閉じる（active タブだったら隣のタブ or null をアクティブ化）
  closeMdTab: (id: string, tabId: string) => void;
  // エディタからの dirty 通知
  setMdDirty: (id: string, tabId: string, dirty: boolean) => void;
  // 保存成功時に savedContent を更新し dirty=false に戻す
  markMdSaved: (id: string, tabId: string, content: string) => void;
  // 全 MD タブを閉じる（viewMode を cli に戻す）
  clearMarkdown: (id: string) => void;
  // 残り MD タブ枠があるか
  canOpenMoreMd: (id: string) => boolean;
}

// セッション内で単調増加するカウンタ（initMeta / touchActive / openMarkdown loadedAt 共用）
let monotonicCounter = 0;
const nextSeq = (): number => ++monotonicCounter;

// MD タブ ID 生成（衝突しなければ簡易な乱数で十分）
function newTabId(): string {
  return `mdt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
      const seq = nextSeq();
      metas.set(id, {
        cwd: null,
        processName: null,
        shellName: null,
        lastActiveAt: seq,
        createdAt: seq,
        viewMode: "cli",
        mdTabs: [],
        activeMdTabId: null,
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
        viewMode: "cli",
        mdTabs: [],
        activeMdTabId: null,
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
      for (const [id, { cwd, mdTabFilePaths }] of entries) {
        const seq = nextSeq();
        const existing = metas.get(id);
        // 復元する MD タブは filePath だけ持ち、savedContent は MarkdownEditor が
        // mount 時に IPC で読み込む前提で空文字列にしておく。dirty=false。
        const restoredTabs: MdTab[] = (mdTabFilePaths ?? []).map((fp) => ({
          id: newTabId(),
          filePath: fp,
          savedContent: "",
          dirty: false,
          loadedAt: nextSeq(),
        }));
        metas.set(id, {
          cwd,
          processName: existing?.processName ?? null,
          shellName: existing?.shellName ?? null,
          // 復元時は順序が決まらないため、エントリ順に createdAt を割り振る
          createdAt: existing?.createdAt ?? seq,
          lastActiveAt: existing?.lastActiveAt ?? seq,
          viewMode: "cli",
          mdTabs: restoredTabs,
          activeMdTabId: restoredTabs[0]?.id ?? null,
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
      // override が null でないペインだけ更新（不要な再レンダリングを防ぐ）
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

    openMarkdown: (id, filePath, content) => {
      const meta = get().metas.get(id);
      if (!meta) return { ok: false, reason: "limit" };
      // 既に同 path のタブがあればそれをアクティブ化（仕様: 案 A）。
      // savedContent / loadedAt はそのまま保持（dirty を破壊しない）。
      const existing = meta.mdTabs.find((t) => t.filePath === filePath);
      if (existing) {
        updateMeta(id, {
          activeMdTabId: existing.id,
          viewMode: "md",
        });
        return { ok: true, tabId: existing.id, existed: true };
      }
      // 新規タブ追加。最大 MD_TABS_MAX を超える場合は何もしない。
      if (meta.mdTabs.length >= MD_TABS_MAX) {
        return { ok: false, reason: "limit" };
      }
      const tab: MdTab = {
        id: newTabId(),
        filePath,
        savedContent: content,
        dirty: false,
        loadedAt: nextSeq(),
      };
      updateMeta(id, {
        mdTabs: [...meta.mdTabs, tab],
        activeMdTabId: tab.id,
        viewMode: "md",
      });
      return { ok: true, tabId: tab.id, existed: false };
    },

    setViewMode: (id, mode) => updateMeta(id, { viewMode: mode }),

    setActiveMdTab: (id, tabId) => {
      const meta = get().metas.get(id);
      if (!meta) return;
      // 渡された tabId が mdTabs に存在しない場合は no-op（外部からの不正値を防ぐ）
      if (tabId !== null && !meta.mdTabs.some((t) => t.id === tabId)) return;
      updateMeta(id, { activeMdTabId: tabId });
    },

    closeMdTab: (id, tabId) => {
      const meta = get().metas.get(id);
      if (!meta) return;
      const idx = meta.mdTabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      const newTabs = meta.mdTabs.filter((t) => t.id !== tabId);
      // 閉じたのが active タブなら、隣のタブをアクティブ化する。
      // - 残タブが 0 → activeMdTabId=null + viewMode を cli に戻す
      // - 残タブあり → 同 index の左隣（無ければ右隣）を active に
      let newActiveId: string | null = meta.activeMdTabId;
      let newViewMode: ViewMode = meta.viewMode;
      if (meta.activeMdTabId === tabId) {
        if (newTabs.length === 0) {
          newActiveId = null;
          // viewMode が md だったなら cli に戻す（chat だったらそのまま）
          if (meta.viewMode === "md") newViewMode = "cli";
        } else {
          const fallback = newTabs[Math.max(0, idx - 1)] ?? newTabs[0];
          newActiveId = fallback.id;
        }
      }
      updateMeta(id, {
        mdTabs: newTabs,
        activeMdTabId: newActiveId,
        viewMode: newViewMode,
      });
    },

    setMdDirty: (id, tabId, dirty) => {
      const meta = get().metas.get(id);
      if (!meta) return;
      const idx = meta.mdTabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      // 値が変わらないなら no-op（不要な再レンダリング抑止）
      if (meta.mdTabs[idx].dirty === dirty) return;
      const newTabs = meta.mdTabs.slice();
      newTabs[idx] = { ...newTabs[idx], dirty };
      updateMeta(id, { mdTabs: newTabs });
    },

    markMdSaved: (id, tabId, content) => {
      const meta = get().metas.get(id);
      if (!meta) return;
      const idx = meta.mdTabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      const newTabs = meta.mdTabs.slice();
      newTabs[idx] = { ...newTabs[idx], savedContent: content, dirty: false };
      updateMeta(id, { mdTabs: newTabs });
    },

    clearMarkdown: (id) => {
      const meta = get().metas.get(id);
      if (!meta) return;
      updateMeta(id, {
        mdTabs: [],
        activeMdTabId: null,
        viewMode: meta.viewMode === "md" ? "cli" : meta.viewMode,
      });
    },

    canOpenMoreMd: (id) => {
      const meta = get().metas.get(id);
      if (!meta) return false;
      return meta.mdTabs.length < MD_TABS_MAX;
    },
  };
});

// セレクター: 特定IDのメタデータのみ購読（不要な再レンダリングを防ぐ）
export function useTerminalMeta(id: string): TerminalMeta | undefined {
  return useTerminalMetaStore((s) => s.metas.get(id));
}

// 指定ペインのアクティブな MD タブを取得するヘルパー
export function getActiveMdTab(meta: TerminalMeta | undefined): MdTab | null {
  if (!meta || !meta.activeMdTabId) return null;
  return meta.mdTabs.find((t) => t.id === meta.activeMdTabId) ?? null;
}
