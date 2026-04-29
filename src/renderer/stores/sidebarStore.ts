import { create } from "zustand";

export type InteractionArea = "sidebar" | "terminal";

interface SidebarStore {
  isOpen: boolean;
  width: number;
  expandedPaths: Set<string>;
  selectedTabCwd: string | null;
  selectedNodePath: string | null;
  editingPath: string | null;
  // ディレクトリツリーのファイル名フィルタ。空文字なら無効。
  searchQuery: string;
  // Cmd+Z / Cmd+Shift+Z をサイドバーとターミナルどちらに振り分けるかの判定材料。
  // mousedown / focus 時に更新する。
  lastInteractedArea: InteractionArea;

  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setWidth: (width: number) => void;
  setExpanded: (path: string, expanded: boolean) => void;
  isExpanded: (path: string) => boolean;
  setSelectedTabCwd: (cwd: string | null) => void;
  setSelectedNodePath: (path: string | null) => void;
  setEditingPath: (path: string | null) => void;
  setSearchQuery: (query: string) => void;
  resetExpansionForCwd: (cwd: string) => void;
  setLastInteractedArea: (area: InteractionArea) => void;
}

const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 180;
const MAX_WIDTH = 600;

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
}

export const SIDEBAR_WIDTH_BOUNDS = {
  min: MIN_WIDTH,
  max: MAX_WIDTH,
  default: DEFAULT_WIDTH,
} as const;

export const useSidebarStore = create<SidebarStore>((set, get) => ({
  isOpen: true,
  width: DEFAULT_WIDTH,
  expandedPaths: new Set<string>(),
  selectedTabCwd: null,
  selectedNodePath: null,
  editingPath: null,
  searchQuery: "",
  lastInteractedArea: "terminal",

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setOpen: (open) => set({ isOpen: open }),
  setWidth: (width) => set({ width: clampSidebarWidth(width) }),

  setExpanded: (path, expanded) => {
    const current = get().expandedPaths;
    // 値が変わらない呼び出しは早期 return して不要な再レンダリングを防ぐ
    if (current.has(path) === expanded) return;
    const next = new Set(current);
    if (expanded) {
      next.add(path);
    } else {
      next.delete(path);
    }
    set({ expandedPaths: next });
  },

  isExpanded: (path) => get().expandedPaths.has(path),

  setSelectedTabCwd: (cwd) => set({ selectedTabCwd: cwd }),
  setSelectedNodePath: (path) => set({ selectedNodePath: path }),
  setEditingPath: (path) => set({ editingPath: path }),

  setSearchQuery: (query) => {
    if (get().searchQuery === query) return;
    set({ searchQuery: query });
  },

  // タブ切替時に他タブの展開状態を保持しないオプション（今回は呼び出さないが API として用意）
  resetExpansionForCwd: (cwd) => {
    const next = new Set<string>();
    for (const p of get().expandedPaths) {
      if (!p.startsWith(cwd)) next.add(p);
    }
    set({ expandedPaths: next });
  },

  setLastInteractedArea: (area) => {
    if (get().lastInteractedArea === area) return;
    set({ lastInteractedArea: area });
  },
}));

export const useSidebarOpen = (): boolean => useSidebarStore((s) => s.isOpen);
export const useSidebarWidth = (): number => useSidebarStore((s) => s.width);
