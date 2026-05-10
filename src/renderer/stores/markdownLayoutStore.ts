import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { SplitDirection } from "../types/layout";
import {
  isMdPane,
  type MdLayoutNode,
  type MdPane,
  type MdSplitNode,
} from "../types/mdLayout";

// RightSidebar 内 Markdown ペインの二分木レイアウトストア。
// terminalStore と同じ「flat Map + parentId/children」構造で、
// 葉ペインだけが tabIds[] / activeTabId を保持する。
// ストア自体は永続化しない（MD タブ・ペイン構造はセッション内のみ。
// CLAUDE.md §3.7 の方針に従う）。

export const MAX_MD_PANES = 6;

function generateId(): string {
  return `mdpane-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface MarkdownLayoutStore {
  nodes: Map<string, MdLayoutNode>;
  rootId: string;
  activePaneId: string | null;
  paneCount: number;

  setActivePane: (paneId: string | null) => void;
  splitPane: (paneId: string, direction: SplitDirection) => boolean;
  closePane: (paneId: string) => void;
  canSplit: () => boolean;

  // 既存タブをアクティブペインに追加（同一 tabId が他ペインに居ればそちらを active 化）。
  // 戻り値: タブを担当するペイン id。
  attachTabToActivePane: (tabId: string) => string | null;
  // 既存タブを別ペインへ移したい / 直接指定で活性化したいとき。
  setPaneActiveTab: (paneId: string, tabId: string | null) => void;
  // ペイン内のタブを閉じる（残った activeTab を隣に切替）。
  // 戻り値 true: ペインに残タブあり、false: ペインが空になった。
  removeTabFromPane: (paneId: string, tabId: string) => boolean;
  // tabId を持つペイン id を返す（無ければ null）。
  findPaneByTabId: (tabId: string) => string | null;
  // 全ペインリセット（テスト用）。
  resetToSinglePane: () => void;
}

function createInitialState(): {
  nodes: Map<string, MdLayoutNode>;
  rootId: string;
  activePaneId: string;
  paneCount: number;
} {
  const initialPaneId = generateId();
  const nodes = new Map<string, MdLayoutNode>();
  const initialPane: MdPane = {
    id: initialPaneId,
    parentId: null,
    tabIds: [],
    activeTabId: null,
  };
  nodes.set(initialPaneId, initialPane);
  return {
    nodes,
    rootId: initialPaneId,
    activePaneId: initialPaneId,
    paneCount: 1,
  };
}

const initial = createInitialState();

export const useMarkdownLayoutStore = create<MarkdownLayoutStore>(
  (set, get) => ({
    nodes: initial.nodes,
    rootId: initial.rootId,
    activePaneId: initial.activePaneId,
    paneCount: initial.paneCount,

    setActivePane: (paneId) => {
      if (paneId !== null) {
        const node = get().nodes.get(paneId);
        if (!node || !isMdPane(node)) return;
      }
      if (get().activePaneId === paneId) return;
      set({ activePaneId: paneId });
    },

    canSplit: () => get().paneCount < MAX_MD_PANES,

    splitPane: (paneId, direction) => {
      const state = get();
      if (state.paneCount >= MAX_MD_PANES) return false;
      const target = state.nodes.get(paneId);
      if (!target || !isMdPane(target)) return false;

      const newPaneId = generateId();
      const newSplitId = generateId();

      const newPane: MdPane = {
        id: newPaneId,
        parentId: newSplitId,
        tabIds: [],
        activeTabId: null,
      };
      const newSplit: MdSplitNode = {
        id: newSplitId,
        type: "split",
        direction,
        children: [paneId, newPaneId],
        parentId: target.parentId,
      };
      const updatedTarget: MdPane = {
        ...target,
        parentId: newSplitId,
      };

      const newNodes = new Map(state.nodes);
      newNodes.set(newSplitId, newSplit);
      newNodes.set(paneId, updatedTarget);
      newNodes.set(newPaneId, newPane);

      if (target.parentId === null) {
        set({
          nodes: newNodes,
          rootId: newSplitId,
          paneCount: state.paneCount + 1,
          activePaneId: newPaneId,
        });
      } else {
        const parent = state.nodes.get(target.parentId);
        if (!parent || isMdPane(parent)) return false;
        const updatedParent: MdSplitNode = {
          ...parent,
          children: parent.children.map((cid) =>
            cid === paneId ? newSplitId : cid,
          ),
        };
        newNodes.set(parent.id, updatedParent);
        set({
          nodes: newNodes,
          paneCount: state.paneCount + 1,
          activePaneId: newPaneId,
        });
      }
      return true;
    },

    closePane: (paneId) => {
      const state = get();
      const target = state.nodes.get(paneId);
      if (!target || !isMdPane(target)) return;
      // 最後の 1 ペインは閉じない（RightSidebar 全体を閉じる場合は別 API）
      if (state.paneCount === 1) return;

      const newNodes = new Map(state.nodes);
      newNodes.delete(paneId);

      // ルートが葉だけだったケースは paneCount===1 で除外済み。
      // ここに来る paneId は必ず親 split を持つ。
      if (target.parentId === null) return;
      const parentSplit = state.nodes.get(target.parentId);
      if (!parentSplit || isMdPane(parentSplit)) return;
      const siblingId = parentSplit.children.find((id) => id !== paneId);
      if (!siblingId) return;
      const sibling = state.nodes.get(siblingId);
      if (!sibling) return;

      newNodes.delete(parentSplit.id);

      // 兄弟をペアレントの位置に昇格。
      if (parentSplit.parentId === null) {
        const updatedSibling = { ...sibling, parentId: null };
        newNodes.set(siblingId, updatedSibling);
        const fallbackActive = pickActivePaneAfterClose(
          newNodes,
          siblingId,
          state.activePaneId,
          paneId,
        );
        set({
          nodes: newNodes,
          rootId: siblingId,
          paneCount: state.paneCount - 1,
          activePaneId: fallbackActive,
        });
      } else {
        const grand = state.nodes.get(parentSplit.parentId);
        if (!grand || isMdPane(grand)) return;
        const updatedGrand: MdSplitNode = {
          ...grand,
          children: grand.children.map((id) =>
            id === parentSplit.id ? siblingId : id,
          ),
        };
        const updatedSibling = { ...sibling, parentId: grand.id };
        newNodes.set(grand.id, updatedGrand);
        newNodes.set(siblingId, updatedSibling);
        const fallbackActive = pickActivePaneAfterClose(
          newNodes,
          state.rootId,
          state.activePaneId,
          paneId,
        );
        set({
          nodes: newNodes,
          paneCount: state.paneCount - 1,
          activePaneId: fallbackActive,
        });
      }
    },

    attachTabToActivePane: (tabId) => {
      const state = get();
      // 既にどこかのペインに属していれば、そのペインを active 化 + そのタブを active に。
      // activePaneId の有無に依らず探す（active が一時的に null でも所有ペインを優先）。
      const owner = findPaneIdContainingTab(state.nodes, tabId);
      if (owner) {
        const ownerPane = state.nodes.get(owner) as MdPane;
        const newNodes = new Map(state.nodes);
        newNodes.set(owner, { ...ownerPane, activeTabId: tabId });
        set({ nodes: newNodes, activePaneId: owner });
        return owner;
      }

      const activeId = state.activePaneId;
      if (!activeId) return null;
      const activePane = state.nodes.get(activeId);
      if (!activePane || !isMdPane(activePane)) return null;
      const updated: MdPane = {
        ...activePane,
        tabIds: activePane.tabIds.includes(tabId)
          ? activePane.tabIds
          : [...activePane.tabIds, tabId],
        activeTabId: tabId,
      };
      const newNodes = new Map(state.nodes);
      newNodes.set(activeId, updated);
      set({ nodes: newNodes });
      return activeId;
    },

    setPaneActiveTab: (paneId, tabId) => {
      const state = get();
      const pane = state.nodes.get(paneId);
      if (!pane || !isMdPane(pane)) return;
      if (tabId !== null && !pane.tabIds.includes(tabId)) return;
      if (pane.activeTabId === tabId) return;
      const updated: MdPane = { ...pane, activeTabId: tabId };
      const newNodes = new Map(state.nodes);
      newNodes.set(paneId, updated);
      set({ nodes: newNodes });
    },

    removeTabFromPane: (paneId, tabId) => {
      const state = get();
      const pane = state.nodes.get(paneId);
      if (!pane || !isMdPane(pane)) return false;
      if (!pane.tabIds.includes(tabId)) return pane.tabIds.length > 0;
      const idx = pane.tabIds.indexOf(tabId);
      const newTabIds = pane.tabIds.filter((id) => id !== tabId);
      let newActiveId: string | null = pane.activeTabId;
      if (pane.activeTabId === tabId) {
        if (newTabIds.length === 0) {
          newActiveId = null;
        } else {
          // 左隣（無ければ先頭）にフォールバック
          newActiveId = newTabIds[Math.max(0, idx - 1)] ?? newTabIds[0];
        }
      }
      const updated: MdPane = {
        ...pane,
        tabIds: newTabIds,
        activeTabId: newActiveId,
      };
      const newNodes = new Map(state.nodes);
      newNodes.set(paneId, updated);
      set({ nodes: newNodes });
      return newTabIds.length > 0;
    },

    findPaneByTabId: (tabId) => findPaneIdContainingTab(get().nodes, tabId),

    resetToSinglePane: () => {
      const fresh = createInitialState();
      set({
        nodes: fresh.nodes,
        rootId: fresh.rootId,
        activePaneId: fresh.activePaneId,
        paneCount: fresh.paneCount,
      });
    },
  }),
);

function findPaneIdContainingTab(
  nodes: Map<string, MdLayoutNode>,
  tabId: string,
): string | null {
  for (const node of nodes.values()) {
    if (isMdPane(node) && node.tabIds.includes(tabId)) {
      return node.id;
    }
  }
  return null;
}

// closePane 後に有効な activePaneId を選び直す。
// 元の activePane が削除されたペインだった場合、残った最初の葉に落とす。
function pickActivePaneAfterClose(
  nodes: Map<string, MdLayoutNode>,
  rootId: string,
  prevActive: string | null,
  removedPaneId: string,
): string | null {
  if (prevActive && prevActive !== removedPaneId && nodes.has(prevActive)) {
    return prevActive;
  }
  const firstLeaf = collectMdPaneIdsInOrder(rootId, nodes)[0];
  return firstLeaf ?? null;
}

// レイアウトを DFS で走査して葉ペインの id 列を返す（SplitContainer 同等）。
export function collectMdPaneIdsInOrder(
  rootId: string,
  nodes: Map<string, MdLayoutNode>,
): string[] {
  const node = nodes.get(rootId);
  if (!node) return [];
  if (!isMdPane(node)) {
    return node.children.flatMap((cid) => collectMdPaneIdsInOrder(cid, nodes));
  }
  return [rootId];
}

// Selector hooks
export const useMdRootId = (): string =>
  useMarkdownLayoutStore((s) => s.rootId);
export const useMdNodes = (): Map<string, MdLayoutNode> =>
  useMarkdownLayoutStore((s) => s.nodes);
export const useMdActivePaneId = (): string | null =>
  useMarkdownLayoutStore((s) => s.activePaneId);
export const useMdPaneCount = (): number =>
  useMarkdownLayoutStore((s) => s.paneCount);
export const useMdCanSplit = (): (() => boolean) =>
  useMarkdownLayoutStore((s) => s.canSplit);

export const useMarkdownLayoutActions = (): Pick<
  MarkdownLayoutStore,
  | "setActivePane"
  | "splitPane"
  | "closePane"
  | "attachTabToActivePane"
  | "setPaneActiveTab"
  | "removeTabFromPane"
  | "findPaneByTabId"
> =>
  useMarkdownLayoutStore(
    useShallow((s) => ({
      setActivePane: s.setActivePane,
      splitPane: s.splitPane,
      closePane: s.closePane,
      attachTabToActivePane: s.attachTabToActivePane,
      setPaneActiveTab: s.setPaneActiveTab,
      removeTabFromPane: s.removeTabFromPane,
      findPaneByTabId: s.findPaneByTabId,
    })),
  );

export function useMdPane(paneId: string | null): MdPane | null {
  return useMarkdownLayoutStore((s) => {
    if (!paneId) return null;
    const node = s.nodes.get(paneId);
    if (!node || !isMdPane(node)) return null;
    return node;
  });
}
