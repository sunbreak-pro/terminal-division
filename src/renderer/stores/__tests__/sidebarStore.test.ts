import { describe, it, expect, beforeEach } from "vitest";
import {
  useSidebarStore,
  clampSidebarWidth,
  SIDEBAR_WIDTH_BOUNDS,
} from "../sidebarStore";

describe("clampSidebarWidth", () => {
  it("returns the value within bounds unchanged", () => {
    expect(clampSidebarWidth(300)).toBe(300);
  });

  it("clamps below the minimum", () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_WIDTH_BOUNDS.min);
  });

  it("clamps above the maximum", () => {
    expect(clampSidebarWidth(2000)).toBe(SIDEBAR_WIDTH_BOUNDS.max);
  });

  it("rounds to integer", () => {
    expect(clampSidebarWidth(260.7)).toBe(261);
  });

  it("falls back to default for non-finite values", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_BOUNDS.default);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(
      SIDEBAR_WIDTH_BOUNDS.default,
    );
  });
});

describe("sidebarStore", () => {
  beforeEach(() => {
    useSidebarStore.setState({
      isOpen: true,
      width: SIDEBAR_WIDTH_BOUNDS.default,
      expandedPaths: new Set<string>(),
      selectedTabCwd: null,
      selectedNodePath: null,
      editingPath: null,
    });
  });

  it("toggleOpen flips isOpen", () => {
    expect(useSidebarStore.getState().isOpen).toBe(true);
    useSidebarStore.getState().toggleOpen();
    expect(useSidebarStore.getState().isOpen).toBe(false);
    useSidebarStore.getState().toggleOpen();
    expect(useSidebarStore.getState().isOpen).toBe(true);
  });

  it("setWidth clamps to bounds", () => {
    useSidebarStore.getState().setWidth(50);
    expect(useSidebarStore.getState().width).toBe(SIDEBAR_WIDTH_BOUNDS.min);
    useSidebarStore.getState().setWidth(99999);
    expect(useSidebarStore.getState().width).toBe(SIDEBAR_WIDTH_BOUNDS.max);
  });

  it("setExpanded(true) adds the path", () => {
    useSidebarStore.getState().setExpanded("/x", true);
    expect(useSidebarStore.getState().isExpanded("/x")).toBe(true);
  });

  it("setExpanded(false) removes the path", () => {
    useSidebarStore.getState().setExpanded("/x", true);
    useSidebarStore.getState().setExpanded("/x", false);
    expect(useSidebarStore.getState().isExpanded("/x")).toBe(false);
  });

  it("setExpanded is idempotent (no new Set when value unchanged)", () => {
    useSidebarStore.getState().setExpanded("/x", true);
    const before = useSidebarStore.getState().expandedPaths;
    useSidebarStore.getState().setExpanded("/x", true);
    const after = useSidebarStore.getState().expandedPaths;
    // 同じ値なら参照を更新しない (再レンダリング抑制)
    expect(after).toBe(before);
  });

  it("setExpanded creates a new Set when value changes", () => {
    const before = useSidebarStore.getState().expandedPaths;
    useSidebarStore.getState().setExpanded("/x", true);
    const after = useSidebarStore.getState().expandedPaths;
    expect(after).not.toBe(before);
  });

  it("resetExpansionForCwd removes paths under given cwd", () => {
    const store = useSidebarStore.getState();
    store.setExpanded("/proj/a", true);
    store.setExpanded("/proj/a/sub", true);
    store.setExpanded("/other/b", true);
    store.resetExpansionForCwd("/proj");
    const expanded = useSidebarStore.getState().expandedPaths;
    expect(expanded.has("/proj/a")).toBe(false);
    expect(expanded.has("/proj/a/sub")).toBe(false);
    expect(expanded.has("/other/b")).toBe(true);
  });

  it("setSelectedTabCwd updates the selection", () => {
    useSidebarStore.getState().setSelectedTabCwd("/x");
    expect(useSidebarStore.getState().selectedTabCwd).toBe("/x");
    useSidebarStore.getState().setSelectedTabCwd(null);
    expect(useSidebarStore.getState().selectedTabCwd).toBeNull();
  });

  it("setEditingPath updates the editing target", () => {
    useSidebarStore.getState().setEditingPath("/x/file.txt");
    expect(useSidebarStore.getState().editingPath).toBe("/x/file.txt");
    useSidebarStore.getState().setEditingPath(null);
    expect(useSidebarStore.getState().editingPath).toBeNull();
  });
});
