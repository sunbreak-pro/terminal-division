import { describe, it, expect, beforeEach } from "vitest";
import {
  useMarkdownLayoutStore,
  collectMdPaneIdsInOrder,
  MAX_MD_PANES,
} from "../markdownLayoutStore";
import { isMdPane, type MdPane } from "../../types/mdLayout";

describe("markdownLayoutStore", () => {
  beforeEach(() => {
    useMarkdownLayoutStore.getState().resetToSinglePane();
  });

  describe("initial state", () => {
    it("starts with a single empty pane that is active", () => {
      const s = useMarkdownLayoutStore.getState();
      expect(s.paneCount).toBe(1);
      expect(s.activePaneId).toBe(s.rootId);
      const pane = s.nodes.get(s.rootId);
      expect(pane).toBeDefined();
      if (!pane || !isMdPane(pane)) throw new Error("root is not a pane");
      expect(pane.tabIds).toEqual([]);
      expect(pane.activeTabId).toBeNull();
    });
  });

  describe("splitPane", () => {
    it("creates a new sibling pane and makes it active", () => {
      const s0 = useMarkdownLayoutStore.getState();
      const ok = s0.splitPane(s0.rootId, "horizontal");
      expect(ok).toBe(true);
      const s1 = useMarkdownLayoutStore.getState();
      expect(s1.paneCount).toBe(2);
      // root はもう split ノード
      const root = s1.nodes.get(s1.rootId);
      expect(root && !isMdPane(root)).toBe(true);
      // active は新ペイン（元のペインではない）
      expect(s1.activePaneId).not.toBe(s0.rootId);
      const newActive = s1.nodes.get(s1.activePaneId!);
      expect(newActive && isMdPane(newActive)).toBe(true);
    });

    it("returns false at MAX_MD_PANES", () => {
      const s0 = useMarkdownLayoutStore.getState();
      // 6 ペインまで埋める
      for (let i = 1; i < MAX_MD_PANES; i++) {
        const active = useMarkdownLayoutStore.getState().activePaneId!;
        expect(
          useMarkdownLayoutStore.getState().splitPane(active, "horizontal"),
        ).toBe(true);
      }
      expect(useMarkdownLayoutStore.getState().paneCount).toBe(MAX_MD_PANES);
      const result = useMarkdownLayoutStore
        .getState()
        .splitPane(useMarkdownLayoutStore.getState().activePaneId!, "vertical");
      expect(result).toBe(false);
      void s0;
    });
  });

  describe("closePane", () => {
    it("does nothing for the last remaining pane", () => {
      const s0 = useMarkdownLayoutStore.getState();
      s0.closePane(s0.rootId);
      const s1 = useMarkdownLayoutStore.getState();
      expect(s1.paneCount).toBe(1);
      expect(s1.rootId).toBe(s0.rootId);
    });

    it("collapses parent split when sibling becomes the only child", () => {
      const initial = useMarkdownLayoutStore.getState().rootId;
      useMarkdownLayoutStore.getState().splitPane(initial, "horizontal");
      const afterSplit = useMarkdownLayoutStore.getState();
      // active = newPane を閉じると root は元の initial に戻る
      const newPaneId = afterSplit.activePaneId!;
      useMarkdownLayoutStore.getState().closePane(newPaneId);
      const s = useMarkdownLayoutStore.getState();
      expect(s.paneCount).toBe(1);
      expect(s.rootId).toBe(initial);
      expect(s.activePaneId).toBe(initial);
    });
  });

  describe("attachTabToActivePane", () => {
    it("appends a new tabId to the active pane and activates it", () => {
      const s0 = useMarkdownLayoutStore.getState();
      const owner = s0.attachTabToActivePane("tab1");
      expect(owner).toBe(s0.rootId);
      const pane = useMarkdownLayoutStore.getState().nodes.get(s0.rootId) as
        | MdPane
        | undefined;
      expect(pane?.tabIds).toEqual(["tab1"]);
      expect(pane?.activeTabId).toBe("tab1");
    });

    it("re-uses the existing owning pane when tab is already attached", () => {
      const s0 = useMarkdownLayoutStore.getState();
      s0.attachTabToActivePane("tab1");
      // ペイン分割。新ペインが active になる
      s0.splitPane(s0.rootId, "horizontal");
      const newActive = useMarkdownLayoutStore.getState().activePaneId!;
      expect(newActive).not.toBe(s0.rootId);
      // tab1 を attach すると、所属ペイン (rootId) が active 化される
      const owner = useMarkdownLayoutStore
        .getState()
        .attachTabToActivePane("tab1");
      expect(owner).toBe(s0.rootId);
      const after = useMarkdownLayoutStore.getState();
      expect(after.activePaneId).toBe(s0.rootId);
      // 元のペインの activeTab は tab1 のまま
      const root = after.nodes.get(s0.rootId) as MdPane;
      expect(root.activeTabId).toBe("tab1");
    });
  });

  describe("removeTabFromPane", () => {
    it("removes the tab and falls back to a sibling when active", () => {
      const s0 = useMarkdownLayoutStore.getState();
      s0.attachTabToActivePane("a");
      s0.attachTabToActivePane("b");
      s0.attachTabToActivePane("c");
      const root = s0.rootId;
      // active=c を消す → b が active に（左隣）
      const stillHas = useMarkdownLayoutStore
        .getState()
        .removeTabFromPane(root, "c");
      expect(stillHas).toBe(true);
      const pane = useMarkdownLayoutStore.getState().nodes.get(root) as MdPane;
      expect(pane.tabIds).toEqual(["a", "b"]);
      expect(pane.activeTabId).toBe("b");
    });

    it("clears activeTabId when last tab in pane is removed", () => {
      const s0 = useMarkdownLayoutStore.getState();
      s0.attachTabToActivePane("only");
      const remained = useMarkdownLayoutStore
        .getState()
        .removeTabFromPane(s0.rootId, "only");
      expect(remained).toBe(false);
      const pane = useMarkdownLayoutStore.getState().nodes.get(s0.rootId) as
        | MdPane
        | undefined;
      expect(pane?.tabIds).toEqual([]);
      expect(pane?.activeTabId).toBeNull();
    });
  });

  describe("findPaneByTabId", () => {
    it("locates the pane containing a given tabId", () => {
      const s0 = useMarkdownLayoutStore.getState();
      s0.attachTabToActivePane("alpha");
      s0.splitPane(s0.rootId, "horizontal");
      const newActive = useMarkdownLayoutStore.getState().activePaneId!;
      useMarkdownLayoutStore.getState().attachTabToActivePane("beta");
      const apha = useMarkdownLayoutStore.getState().findPaneByTabId("alpha");
      const beta = useMarkdownLayoutStore.getState().findPaneByTabId("beta");
      expect(apha).toBe(s0.rootId);
      expect(beta).toBe(newActive);
      expect(
        useMarkdownLayoutStore.getState().findPaneByTabId("nonexistent"),
      ).toBeNull();
    });
  });

  describe("collectMdPaneIdsInOrder", () => {
    it("returns leaves in DFS order matching SplitContainer rendering", () => {
      const s0 = useMarkdownLayoutStore.getState();
      const initial = s0.rootId;
      s0.splitPane(initial, "horizontal");
      const order = collectMdPaneIdsInOrder(
        useMarkdownLayoutStore.getState().rootId,
        useMarkdownLayoutStore.getState().nodes,
      );
      // 元ペインが先頭、新ペインが末尾
      expect(order[0]).toBe(initial);
      expect(order.length).toBe(2);
    });
  });
});
