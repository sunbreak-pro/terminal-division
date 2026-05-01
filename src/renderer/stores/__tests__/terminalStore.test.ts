import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTerminalStore } from "../terminalStore";
import { useTerminalMetaStore } from "../terminalMetaStore";
import type { SplitNode, TerminalPane } from "../../types/layout";
import * as terminalManager from "../../services/terminalManager";

// terminalManagerとwindow.api.ptyをモック
vi.mock("../../services/terminalManager", () => ({
  destroy: vi.fn(),
}));

// グローバルwindow.api のモック
Object.defineProperty(window, "api", {
  value: {
    pty: {
      kill: vi.fn(),
    },
  },
  writable: true,
});

describe("terminalStore", () => {
  beforeEach(() => {
    // ストアを初期状態にリセット
    useTerminalStore.setState({
      nodes: new Map([["initial", { id: "initial", parentId: null }]]),
      rootId: "initial",
      activeTerminalId: "initial",
      terminalCount: 1,
    });
    useTerminalMetaStore.setState({ metas: new Map() });
    vi.clearAllMocks();
  });

  describe("setActiveTerminal", () => {
    it("should set active terminal id", () => {
      const { setActiveTerminal } = useTerminalStore.getState();
      setActiveTerminal("new-terminal");
      expect(useTerminalStore.getState().activeTerminalId).toBe("new-terminal");
    });

    it("should allow setting null", () => {
      const { setActiveTerminal } = useTerminalStore.getState();
      setActiveTerminal(null);
      expect(useTerminalStore.getState().activeTerminalId).toBeNull();
    });
  });

  describe("canSplit", () => {
    it("should return true when under MAX_TERMINALS", () => {
      const { canSplit } = useTerminalStore.getState();
      expect(canSplit()).toBe(true);
    });

    it("should return false when at MAX_TERMINALS", () => {
      useTerminalStore.setState({ terminalCount: 6 });
      const { canSplit } = useTerminalStore.getState();
      expect(canSplit()).toBe(false);
    });
  });

  describe("splitTerminal", () => {
    it("should split a terminal pane horizontally", () => {
      const { splitTerminal } = useTerminalStore.getState();
      const result = splitTerminal("initial", "horizontal");

      expect(result).toBe(true);

      const state = useTerminalStore.getState();
      expect(state.terminalCount).toBe(2);

      // ルートはSplitNodeに変わる
      const rootNode = state.nodes.get(state.rootId) as SplitNode;
      expect(rootNode.type).toBe("split");
      expect(rootNode.direction).toBe("horizontal");
      expect(rootNode.children).toHaveLength(2);
    });

    it("should split a terminal pane vertically", () => {
      const { splitTerminal } = useTerminalStore.getState();
      const result = splitTerminal("initial", "vertical");

      expect(result).toBe(true);

      const state = useTerminalStore.getState();
      const rootNode = state.nodes.get(state.rootId) as SplitNode;
      expect(rootNode.direction).toBe("vertical");
    });

    it("should set new terminal as active", () => {
      const { splitTerminal } = useTerminalStore.getState();
      splitTerminal("initial", "horizontal");

      const state = useTerminalStore.getState();
      // 新しいターミナルがアクティブになる（initialではない）
      expect(state.activeTerminalId).not.toBe("initial");
    });

    it("should fail when MAX_TERMINALS reached", () => {
      useTerminalStore.setState({ terminalCount: 6 });
      const { splitTerminal } = useTerminalStore.getState();
      const result = splitTerminal("initial", "horizontal");

      expect(result).toBe(false);
      expect(useTerminalStore.getState().terminalCount).toBe(6);
    });

    it("should fail for non-existent terminal", () => {
      const { splitTerminal } = useTerminalStore.getState();
      const result = splitTerminal("non-existent", "horizontal");

      expect(result).toBe(false);
      expect(useTerminalStore.getState().terminalCount).toBe(1);
    });

    it("should initialize meta for the new pane even when source has no cwd", () => {
      // 親ペインに meta が無い状態で split → 新ペインの meta は必ず初期化される
      const { splitTerminal } = useTerminalStore.getState();
      splitTerminal("initial", "horizontal");

      const state = useTerminalStore.getState();
      const rootNode = state.nodes.get(state.rootId) as SplitNode;
      const newTerminalId = rootNode.children[1];

      const meta = useTerminalMetaStore.getState().metas.get(newTerminalId);
      expect(meta).toBeDefined();
      expect(meta?.cwd).toBeNull();
    });

    it("should inherit cwd from source pane when source has cwd set", () => {
      const metaStore = useTerminalMetaStore.getState();
      metaStore.initMeta("initial");
      metaStore.setCwd("initial", "/Users/test/project");

      const { splitTerminal } = useTerminalStore.getState();
      splitTerminal("initial", "horizontal");

      const state = useTerminalStore.getState();
      const rootNode = state.nodes.get(state.rootId) as SplitNode;
      const newTerminalId = rootNode.children[1];

      const meta = useTerminalMetaStore.getState().metas.get(newTerminalId);
      expect(meta?.cwd).toBe("/Users/test/project");
    });

    it("notifies metaStore subscribers exactly once during split (no intermediate state)", () => {
      const sub = vi.fn();
      const unsub = useTerminalMetaStore.subscribe(sub);

      const { splitTerminal } = useTerminalStore.getState();
      splitTerminal("initial", "horizontal");

      // initLeafMeta により init と cwd 設定が 1 回の set にまとまる
      expect(sub).toHaveBeenCalledTimes(1);
      unsub();
    });

    it("should properly update parent references when splitting nested terminal", () => {
      const { splitTerminal } = useTerminalStore.getState();

      // 最初のスプリット
      splitTerminal("initial", "horizontal");
      const state1 = useTerminalStore.getState();
      const rootNode = state1.nodes.get(state1.rootId) as SplitNode;
      const newTerminalId = rootNode.children[1];

      // 新しいターミナルを更にスプリット
      splitTerminal(newTerminalId, "vertical");

      const state2 = useTerminalStore.getState();
      expect(state2.terminalCount).toBe(3);

      // ルートはそのまま
      expect(state2.rootId).toBe(state1.rootId);
    });
  });

  describe("closeTerminal", () => {
    it("should not close the last terminal", () => {
      const { closeTerminal } = useTerminalStore.getState();
      closeTerminal("initial");

      expect(useTerminalStore.getState().terminalCount).toBe(1);
    });

    it("should close terminal and promote sibling to root", () => {
      const { splitTerminal, closeTerminal } = useTerminalStore.getState();
      splitTerminal("initial", "horizontal");

      const stateAfterSplit = useTerminalStore.getState();
      const rootNode = stateAfterSplit.nodes.get(
        stateAfterSplit.rootId,
      ) as SplitNode;
      const newTerminalId = rootNode.children[1];

      closeTerminal("initial");

      const stateAfterClose = useTerminalStore.getState();
      expect(stateAfterClose.terminalCount).toBe(1);
      // 残ったターミナルがルートになる
      expect(stateAfterClose.rootId).toBe(newTerminalId);
      // 親参照はnullになる
      const remainingNode = stateAfterClose.nodes.get(
        newTerminalId,
      ) as TerminalPane;
      expect(remainingNode.parentId).toBeNull();
    });

    it("should update active terminal when closing active terminal", () => {
      const { splitTerminal, closeTerminal, setActiveTerminal } =
        useTerminalStore.getState();
      splitTerminal("initial", "horizontal");

      const stateAfterSplit = useTerminalStore.getState();
      const rootNode = stateAfterSplit.nodes.get(
        stateAfterSplit.rootId,
      ) as SplitNode;
      const newTerminalId = rootNode.children[1];

      // アクティブターミナルを閉じる
      setActiveTerminal(newTerminalId);
      closeTerminal(newTerminalId);

      const stateAfterClose = useTerminalStore.getState();
      // 別のターミナルがアクティブになる
      expect(stateAfterClose.activeTerminalId).toBe("initial");
    });

    it("should call terminalManager.destroy and pty.kill", () => {
      const { splitTerminal, closeTerminal } = useTerminalStore.getState();

      splitTerminal("initial", "horizontal");
      closeTerminal("initial");

      expect(terminalManager.destroy).toHaveBeenCalledWith("initial");
      expect(window.api.pty.kill).toHaveBeenCalledWith("initial");
    });
  });

  describe("MAX_TERMINALS limit", () => {
    it("should allow exactly 6 terminals", () => {
      const { splitTerminal } = useTerminalStore.getState();

      // 初期1 + 5スプリット = 6ターミナル
      for (let i = 0; i < 5; i++) {
        const state = useTerminalStore.getState();
        // 最後のアクティブターミナルをスプリット
        const result = splitTerminal(state.activeTerminalId!, "horizontal");
        expect(result).toBe(true);
      }

      expect(useTerminalStore.getState().terminalCount).toBe(6);

      // 7つ目は失敗する
      const state = useTerminalStore.getState();
      const result = splitTerminal(state.activeTerminalId!, "horizontal");
      expect(result).toBe(false);
      expect(useTerminalStore.getState().terminalCount).toBe(6);
    });
  });

  describe("hydrateLayout", () => {
    it("should replace store with provided layout (split + 2 leaves)", () => {
      const split: SplitNode = {
        id: "s1",
        type: "split",
        direction: "horizontal",
        children: ["a", "b"],
        parentId: null,
      };
      const a: TerminalPane = { id: "a", parentId: "s1" };
      const b: TerminalPane = { id: "b", parentId: "s1" };
      const nodes = new Map<string, SplitNode | TerminalPane>([
        ["s1", split],
        ["a", a],
        ["b", b],
      ]);

      const ok = useTerminalStore
        .getState()
        .hydrateLayout({ nodes, rootId: "s1", activeTerminalId: "b" });

      expect(ok).toBe(true);
      const state = useTerminalStore.getState();
      expect(state.rootId).toBe("s1");
      expect(state.terminalCount).toBe(2);
      expect(state.activeTerminalId).toBe("b");
      expect(state.nodes.size).toBe(3);
    });

    it("should reject when rootId is missing in nodes", () => {
      const a: TerminalPane = { id: "a", parentId: null };
      const nodes = new Map([["a", a]]);
      const ok = useTerminalStore
        .getState()
        .hydrateLayout({ nodes, rootId: "missing" });
      expect(ok).toBe(false);
    });

    it("should reject when leaf count exceeds MAX_TERMINALS", () => {
      // 7 leaves with no splits — invalid but tests cap enforcement
      const nodes = new Map<string, TerminalPane>();
      for (let i = 0; i < 7; i++) {
        nodes.set(`p${i}`, { id: `p${i}`, parentId: null });
      }
      const ok = useTerminalStore
        .getState()
        .hydrateLayout({ nodes, rootId: "p0" });
      expect(ok).toBe(false);
    });

    it("should fall back to first leaf when activeTerminalId is not a leaf", () => {
      const split: SplitNode = {
        id: "s1",
        type: "split",
        direction: "vertical",
        children: ["a", "b"],
        parentId: null,
      };
      const a: TerminalPane = { id: "a", parentId: "s1" };
      const b: TerminalPane = { id: "b", parentId: "s1" };
      const nodes = new Map<string, SplitNode | TerminalPane>([
        ["s1", split],
        ["a", a],
        ["b", b],
      ]);
      const ok = useTerminalStore
        .getState()
        .hydrateLayout({ nodes, rootId: "s1", activeTerminalId: "s1" });
      expect(ok).toBe(true);
      // active は最初の葉（a または b のどちらか）
      const active = useTerminalStore.getState().activeTerminalId;
      expect(["a", "b"]).toContain(active);
    });
  });
});
