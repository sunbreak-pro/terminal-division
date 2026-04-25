import { describe, it, expect, vi } from "vitest";

// session-state.ts は import 時に new SessionStateManager() を実行し
// app.getPath('userData') を呼ぶため、electron をモックする
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn().mockReturnValue("/tmp"),
  },
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

import { validateSerializedLayout } from "../session-state";
import {
  SESSION_STATE_VERSION,
  type SerializedLayout,
} from "../types/session-state";

const validLayout = (): SerializedLayout => ({
  version: SESSION_STATE_VERSION,
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
    ["b", { cwd: null }],
  ],
});

describe("validateSerializedLayout", () => {
  it("accepts a well-formed layout", () => {
    const result = validateSerializedLayout(validLayout());
    expect(result).not.toBeNull();
    expect(result?.rootId).toBe("s1");
    expect(result?.nodes).toHaveLength(3);
  });

  it("rejects null / non-object input", () => {
    expect(validateSerializedLayout(null)).toBeNull();
    expect(validateSerializedLayout(undefined)).toBeNull();
    expect(validateSerializedLayout("string")).toBeNull();
    expect(validateSerializedLayout(42)).toBeNull();
  });

  it("rejects wrong version", () => {
    const layout = validLayout();
    (layout as unknown as Record<string, unknown>).version = 999;
    expect(validateSerializedLayout(layout)).toBeNull();
  });

  it("rejects missing rootId", () => {
    const layout = validLayout();
    (layout as unknown as Record<string, unknown>).rootId = "";
    expect(validateSerializedLayout(layout)).toBeNull();
  });

  it("rejects rootId not present in nodes", () => {
    const layout = validLayout();
    layout.rootId = "missing";
    expect(validateSerializedLayout(layout)).toBeNull();
  });

  it("rejects rootId whose parentId is non-null", () => {
    const layout = validLayout();
    // root の parentId を非 null に書き換え
    layout.nodes[0][1] = {
      ...layout.nodes[0][1],
      parentId: "s2",
    };
    expect(validateSerializedLayout(layout)).toBeNull();
  });

  it("rejects when leaf count exceeds 6", () => {
    // 7 panes flat (multiple roots — invalid structure but tests cap)
    const nodes: SerializedLayout["nodes"] = [];
    for (let i = 0; i < 7; i++) {
      nodes.push([`p${i}`, { id: `p${i}`, parentId: null }]);
    }
    const layout: SerializedLayout = {
      version: SESSION_STATE_VERSION,
      rootId: "p0",
      nodes,
      metas: [],
    };
    expect(validateSerializedLayout(layout)).toBeNull();
  });

  it("rejects parent/children mismatch", () => {
    const layout = validLayout();
    // child の parentId を書き換える
    layout.nodes[1][1] = {
      ...layout.nodes[1][1],
      parentId: "wrong",
    };
    expect(validateSerializedLayout(layout)).toBeNull();
  });

  it("rejects orphaned nodes not reachable from root", () => {
    const layout = validLayout();
    layout.nodes.push(["orphan", { id: "orphan", parentId: null }]);
    expect(validateSerializedLayout(layout)).toBeNull();
  });

  it("rejects invalid direction value", () => {
    const layout = validLayout();
    layout.nodes[0][1] = {
      ...layout.nodes[0][1],
      direction: "diagonal" as unknown as "horizontal",
    };
    expect(validateSerializedLayout(layout)).toBeNull();
  });

  it("rejects split with wrong children count", () => {
    const layout = validLayout();
    const split = layout.nodes[0][1] as unknown as Record<string, unknown>;
    split.children = ["a"];
    expect(validateSerializedLayout(layout)).toBeNull();
  });

  it("drops meta entries pointing to split nodes", () => {
    const layout = validLayout();
    layout.metas.push(["s1", { cwd: "/should-be-dropped" }]);
    const result = validateSerializedLayout(layout);
    expect(result).not.toBeNull();
    const ids = result!.metas.map(([id]) => id);
    expect(ids).not.toContain("s1");
  });

  it("drops meta entries pointing to unknown ids", () => {
    const layout = validLayout();
    layout.metas.push(["ghost", { cwd: "/x" }]);
    const result = validateSerializedLayout(layout);
    expect(result).not.toBeNull();
    const ids = result!.metas.map(([id]) => id);
    expect(ids).not.toContain("ghost");
  });
});
