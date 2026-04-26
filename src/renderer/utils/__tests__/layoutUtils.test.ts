import { describe, it, expect } from "vitest";
import {
  isTerminalPane,
  getAllTerminalIds,
  collectPaneIdsInOrder,
  getPaneNumber,
} from "../layoutUtils";
import type { LayoutNode } from "../../types/layout";

function makeLeaf(id: string, parentId: string | null = null): LayoutNode {
  return { id, parentId };
}

function makeSplit(
  id: string,
  direction: "horizontal" | "vertical",
  children: string[],
  parentId: string | null = null,
): LayoutNode {
  return { id, type: "split", direction, children, parentId };
}

describe("isTerminalPane", () => {
  it("returns true for leaf pane", () => {
    expect(isTerminalPane(makeLeaf("a"))).toBe(true);
  });

  it("returns false for split node", () => {
    expect(isTerminalPane(makeSplit("s", "horizontal", ["a", "b"]))).toBe(
      false,
    );
  });
});

describe("getAllTerminalIds", () => {
  it("returns leaf ids only", () => {
    const nodes = new Map<string, LayoutNode>([
      ["root", makeSplit("root", "horizontal", ["a", "b"])],
      ["a", makeLeaf("a", "root")],
      ["b", makeLeaf("b", "root")],
    ]);
    expect(getAllTerminalIds(nodes).sort()).toEqual(["a", "b"]);
  });

  it("returns single id when only one leaf exists", () => {
    const nodes = new Map<string, LayoutNode>([["solo", makeLeaf("solo")]]);
    expect(getAllTerminalIds(nodes)).toEqual(["solo"]);
  });
});

describe("collectPaneIdsInOrder", () => {
  it("returns single id when root is a leaf", () => {
    const nodes = new Map<string, LayoutNode>([["root", makeLeaf("root")]]);
    expect(collectPaneIdsInOrder("root", nodes)).toEqual(["root"]);
  });

  it("DFS order matches children array order", () => {
    // root [horizontal] → [left, right]
    // left [vertical] → [a, b]
    // right [vertical] → [c, d]
    const nodes = new Map<string, LayoutNode>([
      ["root", makeSplit("root", "horizontal", ["left", "right"])],
      ["left", makeSplit("left", "vertical", ["a", "b"], "root")],
      ["right", makeSplit("right", "vertical", ["c", "d"], "root")],
      ["a", makeLeaf("a", "left")],
      ["b", makeLeaf("b", "left")],
      ["c", makeLeaf("c", "right")],
      ["d", makeLeaf("d", "right")],
    ]);
    expect(collectPaneIdsInOrder("root", nodes)).toEqual(["a", "b", "c", "d"]);
  });

  it("returns empty array when root not in map", () => {
    const nodes = new Map<string, LayoutNode>();
    expect(collectPaneIdsInOrder("missing", nodes)).toEqual([]);
  });
});

describe("getPaneNumber", () => {
  it("returns 1-based index for leaf in DFS order", () => {
    const nodes = new Map<string, LayoutNode>([
      ["root", makeSplit("root", "horizontal", ["a", "b", "c"])],
      ["a", makeLeaf("a", "root")],
      ["b", makeLeaf("b", "root")],
      ["c", makeLeaf("c", "root")],
    ]);
    expect(getPaneNumber("root", nodes, "a")).toBe(1);
    expect(getPaneNumber("root", nodes, "b")).toBe(2);
    expect(getPaneNumber("root", nodes, "c")).toBe(3);
  });

  it("returns null for missing paneId", () => {
    const nodes = new Map<string, LayoutNode>([["root", makeLeaf("root")]]);
    expect(getPaneNumber("root", nodes, "absent")).toBeNull();
  });

  it("works for root that is itself a leaf", () => {
    const nodes = new Map<string, LayoutNode>([["solo", makeLeaf("solo")]]);
    expect(getPaneNumber("solo", nodes, "solo")).toBe(1);
  });
});
