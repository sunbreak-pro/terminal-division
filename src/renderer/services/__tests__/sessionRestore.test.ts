import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  serializeCurrentSession,
  deserializeLayout,
  restoreSession,
  type SerializedLayout,
} from "../sessionRestore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useTerminalMetaStore } from "../../stores/terminalMetaStore";

vi.mock("../../services/terminalManager", () => ({
  destroy: vi.fn(),
}));

Object.defineProperty(window, "api", {
  value: { pty: { kill: vi.fn() } },
  writable: true,
});

describe("sessionRestore", () => {
  beforeEach(() => {
    useTerminalStore.setState({
      nodes: new Map([["initial", { id: "initial", parentId: null }]]),
      rootId: "initial",
      activeTerminalId: "initial",
      terminalCount: 1,
    });
    useTerminalMetaStore.setState({ metas: new Map() });
  });

  describe("serializeCurrentSession", () => {
    it("captures the current layout and pane CWDs", () => {
      // 1 pane の初期状態 + cwd を 1 つ設定
      useTerminalMetaStore.getState().initMeta("initial");
      useTerminalMetaStore.getState().setCwd("initial", "/tmp");

      const payload = serializeCurrentSession();
      expect(payload.version).toBe(1);
      expect(payload.rootId).toBe("initial");
      expect(payload.nodes).toHaveLength(1);
      expect(payload.nodes[0]).toEqual([
        "initial",
        { id: "initial", parentId: null },
      ]);
      expect(payload.metas).toEqual([["initial", { cwd: "/tmp" }]]);
    });

    it("excludes split nodes from metas", () => {
      useTerminalStore.setState({
        nodes: new Map([
          [
            "s1",
            {
              id: "s1",
              type: "split",
              direction: "horizontal",
              children: ["a", "b"],
              parentId: null,
            },
          ],
          ["a", { id: "a", parentId: "s1" }],
          ["b", { id: "b", parentId: "s1" }],
        ]),
        rootId: "s1",
        activeTerminalId: "a",
        terminalCount: 2,
      });
      useTerminalMetaStore.getState().initMeta("a");
      useTerminalMetaStore.getState().setCwd("a", "/x");
      useTerminalMetaStore.getState().initMeta("b");

      const payload = serializeCurrentSession();
      const ids = payload.metas.map(([id]) => id);
      expect(ids).not.toContain("s1");
      expect(ids.sort()).toEqual(["a", "b"]);
    });
  });

  describe("deserializeLayout", () => {
    it("returns a valid layout for well-formed payload", () => {
      const payload: SerializedLayout = {
        version: 1,
        rootId: "p1",
        nodes: [["p1", { id: "p1", parentId: null }]],
        metas: [["p1", { cwd: "/home" }]],
      };
      const result = deserializeLayout(payload);
      expect(result).not.toBeNull();
      expect(result?.rootId).toBe("p1");
      expect(result?.nodes.size).toBe(1);
    });

    it("rejects wrong version", () => {
      const payload = {
        version: 999,
        rootId: "p1",
        nodes: [["p1", { id: "p1", parentId: null }]],
        metas: [],
      } as unknown as SerializedLayout;
      expect(deserializeLayout(payload)).toBeNull();
    });

    it("rejects when rootId not in nodes", () => {
      const payload: SerializedLayout = {
        version: 1,
        rootId: "missing",
        nodes: [["p1", { id: "p1", parentId: null }]],
        metas: [],
      };
      expect(deserializeLayout(payload)).toBeNull();
    });

    it("rejects empty nodes array", () => {
      const payload: SerializedLayout = {
        version: 1,
        rootId: "p1",
        nodes: [],
        metas: [],
      };
      expect(deserializeLayout(payload)).toBeNull();
    });

    it("rejects split node with wrong children count", () => {
      const payload = {
        version: 1,
        rootId: "s1",
        nodes: [
          [
            "s1",
            {
              id: "s1",
              type: "split",
              direction: "horizontal",
              children: ["a"],
              parentId: null,
            },
          ],
          ["a", { id: "a", parentId: "s1" }],
        ],
        metas: [],
      } as unknown as SerializedLayout;
      expect(deserializeLayout(payload)).toBeNull();
    });

    it("rejects invalid direction", () => {
      const payload = {
        version: 1,
        rootId: "s1",
        nodes: [
          [
            "s1",
            {
              id: "s1",
              type: "split",
              direction: "diagonal",
              children: ["a", "b"],
              parentId: null,
            },
          ],
          ["a", { id: "a", parentId: "s1" }],
          ["b", { id: "b", parentId: "s1" }],
        ],
        metas: [],
      } as unknown as SerializedLayout;
      expect(deserializeLayout(payload)).toBeNull();
    });
  });

  describe("round-trip", () => {
    it("serialize -> deserialize preserves the layout structure", () => {
      useTerminalStore.setState({
        nodes: new Map([
          [
            "s1",
            {
              id: "s1",
              type: "split",
              direction: "vertical",
              children: ["a", "b"],
              parentId: null,
            },
          ],
          ["a", { id: "a", parentId: "s1" }],
          ["b", { id: "b", parentId: "s1" }],
        ]),
        rootId: "s1",
        activeTerminalId: "a",
        terminalCount: 2,
      });
      useTerminalMetaStore.getState().initMeta("a");
      useTerminalMetaStore.getState().setCwd("a", "/x");
      useTerminalMetaStore.getState().initMeta("b");
      useTerminalMetaStore.getState().setCwd("b", "/y");

      const payload = serializeCurrentSession();
      const result = deserializeLayout(payload);
      expect(result).not.toBeNull();
      expect(result?.nodes.size).toBe(3);
      expect(result?.nodes.get("s1")).toMatchObject({ type: "split" });
      expect(result?.nodes.get("a")?.parentId).toBe("s1");
    });
  });

  describe("restoreSession", () => {
    it("hydrates both stores on success", () => {
      const payload: SerializedLayout = {
        version: 1,
        rootId: "s1",
        nodes: [
          [
            "s1",
            {
              id: "s1",
              type: "split",
              direction: "horizontal",
              children: ["a", "b"],
              parentId: null,
            },
          ],
          ["a", { id: "a", parentId: "s1" }],
          ["b", { id: "b", parentId: "s1" }],
        ],
        metas: [
          ["a", { cwd: "/x" }],
          ["b", { cwd: "/y" }],
        ],
      };
      const ok = restoreSession(payload);
      expect(ok).toBe(true);

      const state = useTerminalStore.getState();
      expect(state.rootId).toBe("s1");
      expect(state.terminalCount).toBe(2);

      const metas = useTerminalMetaStore.getState().metas;
      expect(metas.get("a")?.cwd).toBe("/x");
      expect(metas.get("b")?.cwd).toBe("/y");
    });

    it("returns false for invalid payload and leaves stores untouched", () => {
      const before = useTerminalStore.getState().rootId;
      const ok = restoreSession({
        version: 1,
        rootId: "missing",
        nodes: [["a", { id: "a", parentId: null }]],
        metas: [],
      });
      expect(ok).toBe(false);
      expect(useTerminalStore.getState().rootId).toBe(before);
    });
  });
});
