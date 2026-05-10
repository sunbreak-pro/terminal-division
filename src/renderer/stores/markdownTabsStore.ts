import { create } from "zustand";

// 右サイドバー Markdown エディタの「全タブ集合」グローバルストア。
// 旧仕様の activeTabId / setActive はペイン分割に伴い廃止し、
// 「どのタブがどのペインで表示中か」は markdownLayoutStore が管理する。
// 当ストアはタブ id / filePath / savedContent / dirty / loadedAt のみを扱う。

// アプリ全体で同時に開ける MD タブの最大数。
export const MD_TABS_MAX = 8;

export interface MdTab {
  id: string;
  filePath: string;
  // 最後に保存したファイル内容（dirty 判定の基準）
  savedContent: string;
  // エディタの現在内容と savedContent の差分があるか
  dirty: boolean;
  // openMarkdown で再ロードされたタイミングのカウンタ。
  // 同一ファイル再オープン時の MarkdownEditor remount key 構成要素。
  loadedAt: number;
}

type OpenResult =
  | { ok: true; tabId: string; existed: boolean }
  | { ok: false; reason: "limit" };

interface MarkdownTabsStore {
  tabs: MdTab[];

  // 新規ファイルを開く（既に同 path のタブがあれば既存 id を返す）。
  openMarkdown: (filePath: string, content: string) => OpenResult;
  closeTab: (tabId: string) => void;
  setDirty: (tabId: string, dirty: boolean) => void;
  markSaved: (tabId: string, content: string) => void;
  // 全タブを破棄。
  clearAll: () => void;
  canOpenMore: () => boolean;
}

let monotonicCounter = 0;
const nextSeq = (): number => ++monotonicCounter;

function newTabId(): string {
  return `mdt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useMarkdownTabsStore = create<MarkdownTabsStore>((set, get) => ({
  tabs: [],

  openMarkdown: (filePath, content) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.filePath === filePath);
    if (existing) {
      // 既存タブの savedContent / dirty は破壊しない。
      return { ok: true, tabId: existing.id, existed: true };
    }
    if (tabs.length >= MD_TABS_MAX) {
      return { ok: false, reason: "limit" };
    }
    const tab: MdTab = {
      id: newTabId(),
      filePath,
      savedContent: content,
      dirty: false,
      loadedAt: nextSeq(),
    };
    set({ tabs: [...tabs, tab] });
    return { ok: true, tabId: tab.id, existed: false };
  },

  closeTab: (tabId) => {
    const { tabs } = get();
    if (!tabs.some((t) => t.id === tabId)) return;
    set({ tabs: tabs.filter((t) => t.id !== tabId) });
  },

  setDirty: (tabId, dirty) => {
    const { tabs } = get();
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    if (tabs[idx].dirty === dirty) return;
    const newTabs = tabs.slice();
    newTabs[idx] = { ...newTabs[idx], dirty };
    set({ tabs: newTabs });
  },

  markSaved: (tabId, content) => {
    const { tabs } = get();
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const newTabs = tabs.slice();
    newTabs[idx] = { ...newTabs[idx], savedContent: content, dirty: false };
    set({ tabs: newTabs });
  },

  clearAll: () => set({ tabs: [] }),

  canOpenMore: () => get().tabs.length < MD_TABS_MAX,
}));

export function useMdTab(tabId: string | null): MdTab | null {
  return useMarkdownTabsStore((s) => {
    if (!tabId) return null;
    return s.tabs.find((t) => t.id === tabId) ?? null;
  });
}
