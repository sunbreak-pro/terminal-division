import { describe, it, expect } from "vitest";
import {
  basenameOf,
  parentBasenameOf,
  buildCwdTabs,
  homeRelativePath,
  terminalRelativePath,
  type PaneCwdInput,
} from "../labelCollision";

describe("basenameOf", () => {
  it("returns last segment", () => {
    expect(basenameOf("/Users/foo/bar")).toBe("bar");
  });
  it("strips trailing slash", () => {
    expect(basenameOf("/Users/foo/bar/")).toBe("bar");
  });
  it("returns root for /", () => {
    expect(basenameOf("/")).toBe("/");
  });
});

describe("parentBasenameOf", () => {
  it("returns parent's basename", () => {
    expect(parentBasenameOf("/Users/foo/bar")).toBe("foo");
  });
  it("returns empty string for root-level entries", () => {
    expect(parentBasenameOf("/foo")).toBe("");
  });
  it("strips trailing slash before lookup", () => {
    expect(parentBasenameOf("/Users/foo/bar/")).toBe("foo");
  });
});

const pane = (overrides: Partial<PaneCwdInput>): PaneCwdInput => ({
  paneId: "p",
  cwd: "/tmp",
  createdAt: 1,
  lastActiveAt: 1,
  ...overrides,
});

describe("buildCwdTabs", () => {
  it("returns empty array for no panes", () => {
    expect(buildCwdTabs([])).toEqual([]);
  });

  it("creates one tab per unique CWD", () => {
    const tabs = buildCwdTabs([
      pane({ paneId: "a", cwd: "/x/foo", createdAt: 1 }),
      pane({ paneId: "b", cwd: "/x/bar", createdAt: 2 }),
    ]);
    expect(tabs.map((t) => t.label)).toEqual(["foo", "bar"]);
  });

  it("aggregates panes with the same CWD into one tab", () => {
    const tabs = buildCwdTabs([
      pane({ paneId: "a", cwd: "/x/foo", createdAt: 1 }),
      pane({ paneId: "b", cwd: "/x/foo", createdAt: 2 }),
    ]);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].paneIds.sort()).toEqual(["a", "b"]);
  });

  it("normalizes trailing slashes when grouping", () => {
    const tabs = buildCwdTabs([
      pane({ paneId: "a", cwd: "/x/foo", createdAt: 1 }),
      pane({ paneId: "b", cwd: "/x/foo/", createdAt: 2 }),
    ]);
    expect(tabs).toHaveLength(1);
  });

  it("rewrites colliding labels to 'name (parent)' for ALL conflicting tabs", () => {
    const tabs = buildCwdTabs([
      pane({ paneId: "a", cwd: "/dev/a/foo", createdAt: 1 }),
      pane({ paneId: "b", cwd: "/dev/b/foo", createdAt: 2 }),
      pane({ paneId: "c", cwd: "/dev/x/bar", createdAt: 3 }),
    ]);
    const byCwd = Object.fromEntries(tabs.map((t) => [t.cwd, t.label]));
    expect(byCwd["/dev/a/foo"]).toBe("foo (a)");
    expect(byCwd["/dev/b/foo"]).toBe("foo (b)");
    expect(byCwd["/dev/x/bar"]).toBe("bar");
  });

  it("handles 3-way basename collision", () => {
    const tabs = buildCwdTabs([
      pane({ paneId: "a", cwd: "/x/y/foo", createdAt: 1 }),
      pane({ paneId: "b", cwd: "/a/b/foo", createdAt: 2 }),
      pane({ paneId: "c", cwd: "/p/q/foo", createdAt: 3 }),
    ]);
    expect(tabs.map((t) => t.label).sort()).toEqual([
      "foo (b)",
      "foo (q)",
      "foo (y)",
    ]);
  });

  it("does not rewrite labels for non-colliding tabs", () => {
    const tabs = buildCwdTabs([
      pane({ paneId: "a", cwd: "/dev/foo", createdAt: 1 }),
    ]);
    expect(tabs[0].label).toBe("foo");
  });

  it("orders tabs by first-created pane in each group", () => {
    const tabs = buildCwdTabs([
      pane({ paneId: "a", cwd: "/x/alpha", createdAt: 5 }),
      pane({ paneId: "b", cwd: "/x/beta", createdAt: 2 }),
      pane({ paneId: "c", cwd: "/x/alpha", createdAt: 1 }),
    ]);
    expect(tabs.map((t) => t.cwd)).toEqual(["/x/alpha", "/x/beta"]);
  });

  it("picks the most-recently-active pane as lastActivePaneId", () => {
    const tabs = buildCwdTabs([
      pane({ paneId: "a", cwd: "/x/foo", createdAt: 1, lastActiveAt: 5 }),
      pane({ paneId: "b", cwd: "/x/foo", createdAt: 2, lastActiveAt: 9 }),
      pane({ paneId: "c", cwd: "/x/foo", createdAt: 3, lastActiveAt: 7 }),
    ]);
    expect(tabs[0].lastActivePaneId).toBe("b");
  });
});

describe("buildCwdTabs (pinned)", () => {
  const pane = (over: Partial<PaneCwdInput>): PaneCwdInput => ({
    paneId: "p",
    cwd: "/x/y",
    createdAt: 1,
    lastActiveAt: 1,
    ...over,
  });

  it("pinned 単独 (ペイン無し) のタブが生成される", () => {
    const tabs = buildCwdTabs([], ["/work/project"]);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].cwd).toBe("/work/project");
    expect(tabs[0].pinned).toBe(true);
    expect(tabs[0].paneIds).toEqual([]);
    expect(tabs[0].lastActivePaneId).toBeNull();
  });

  it("ペインと pinned が同 CWD なら 1 タブに合流し pinned: true", () => {
    const tabs = buildCwdTabs(
      [pane({ paneId: "a", cwd: "/work/foo", createdAt: 1, lastActiveAt: 1 })],
      ["/work/foo"],
    );
    expect(tabs).toHaveLength(1);
    expect(tabs[0].cwd).toBe("/work/foo");
    expect(tabs[0].pinned).toBe(true);
    expect(tabs[0].paneIds).toEqual(["a"]);
    expect(tabs[0].lastActivePaneId).toBe("a");
  });

  it("ペイン由来タブは pinned に含まれていなければ pinned: false", () => {
    const tabs = buildCwdTabs(
      [pane({ paneId: "a", cwd: "/work/foo", createdAt: 1, lastActiveAt: 1 })],
      [],
    );
    expect(tabs).toHaveLength(1);
    expect(tabs[0].pinned).toBe(false);
  });

  it("ペイン由来タブが先、pinned-only タブが後ろに並ぶ", () => {
    const tabs = buildCwdTabs(
      [
        pane({ paneId: "a", cwd: "/pane-a", createdAt: 100, lastActiveAt: 1 }),
        pane({ paneId: "b", cwd: "/pane-b", createdAt: 50, lastActiveAt: 1 }),
      ],
      ["/pin-1", "/pin-2"],
    );
    expect(tabs.map((t) => t.cwd)).toEqual([
      "/pane-b",
      "/pane-a",
      "/pin-1",
      "/pin-2",
    ]);
    expect(tabs[2].pinned).toBe(true);
    expect(tabs[3].pinned).toBe(true);
  });

  it("pinned が空配列 (デフォルト) でも従来通り動く", () => {
    const tabs = buildCwdTabs([
      pane({ paneId: "a", cwd: "/work/foo", createdAt: 1, lastActiveAt: 1 }),
    ]);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].pinned).toBe(false);
  });

  it("pinned 重複入力は 1 タブだけ作る", () => {
    const tabs = buildCwdTabs([], ["/work/foo", "/work/foo"]);
    expect(tabs).toHaveLength(1);
  });

  it("ペインも pinned も無ければ空配列", () => {
    expect(buildCwdTabs([], [])).toEqual([]);
  });
});

describe("homeRelativePath", () => {
  it("returns ~ for the home directory itself", () => {
    expect(homeRelativePath("/Users/foo", "/Users/foo")).toBe("~");
  });
  it("rewrites paths inside home with ~", () => {
    expect(homeRelativePath("/Users/foo/bar", "/Users/foo")).toBe("~/bar");
  });
  it("leaves paths outside home untouched", () => {
    expect(homeRelativePath("/etc/passwd", "/Users/foo")).toBe("/etc/passwd");
  });
  it("returns absolute path when home is empty", () => {
    expect(homeRelativePath("/x/y", "")).toBe("/x/y");
  });
});

describe("terminalRelativePath", () => {
  it("returns '.' when path equals base", () => {
    expect(terminalRelativePath("/a/b", "/a/b")).toBe(".");
  });
  it("returns child segment for descendants", () => {
    expect(terminalRelativePath("/a/b/c.txt", "/a/b")).toBe("c.txt");
    expect(terminalRelativePath("/a/b/c/d", "/a/b")).toBe("c/d");
  });
  it("uses '..' for ancestors", () => {
    expect(terminalRelativePath("/a/b", "/a/b/c")).toBe("..");
    expect(terminalRelativePath("/a", "/a/b/c")).toBe("../..");
  });
  it("uses '..' across siblings", () => {
    expect(terminalRelativePath("/a/x/file.txt", "/a/b")).toBe("../x/file.txt");
    expect(
      terminalRelativePath("/Users/foo/Documents/f.txt", "/Users/foo/projects"),
    ).toBe("../Documents/f.txt");
  });
  it("normalizes trailing slashes", () => {
    expect(terminalRelativePath("/a/b/", "/a")).toBe("b");
    expect(terminalRelativePath("/a/b", "/a/")).toBe("b");
  });
  it("returns absolute path when base is empty", () => {
    expect(terminalRelativePath("/a/b", "")).toBe("/a/b");
  });
});
