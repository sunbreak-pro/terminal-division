import { describe, it, expect, beforeEach, vi } from "vitest";
import { listMarkdownFilesAcrossPanes } from "../mdFileListing";
import type { TerminalMeta } from "../../stores/terminalMetaStore";

// window.api.fs.searchTree をモック化
const searchTreeMock = vi.fn();

vi.stubGlobal("window", {
  api: {
    fs: {
      searchTree: (...args: unknown[]) => searchTreeMock(...args),
    },
  },
});

// テスト用の最小限 TerminalMeta（必要フィールドのみ）
function makeMeta(cwd: string | null): TerminalMeta {
  return {
    cwd,
    processName: null,
    shellName: null,
    lastActiveAt: 1,
    createdAt: 1,
    viewMode: "cli",
    mdTabs: [],
    activeMdTabId: null,
    fontSizeOverride: null,
    customTitle: null,
  };
}

describe("listMarkdownFilesAcrossPanes", () => {
  beforeEach(() => {
    searchTreeMock.mockReset();
  });

  it("returns empty list when no panes have cwd", async () => {
    const metas = new Map<string, TerminalMeta>([
      ["p1", makeMeta(null)],
      ["p2", makeMeta(null)],
    ]);
    const result = await listMarkdownFilesAcrossPanes(metas, "");
    expect(result.entries).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(searchTreeMock).not.toHaveBeenCalled();
  });

  it("deduplicates same cwd across multiple panes (search once per unique cwd)", async () => {
    const metas = new Map<string, TerminalMeta>([
      ["p1", makeMeta("/work")],
      ["p2", makeMeta("/work")], // 同 cwd
      ["p3", makeMeta("/other")],
    ]);
    searchTreeMock.mockResolvedValue({
      ok: true,
      entries: [],
      truncated: false,
    });
    await listMarkdownFilesAcrossPanes(metas, "");
    // /work は 1 回、/other は 1 回 = 計 2 回呼ばれる
    expect(searchTreeMock).toHaveBeenCalledTimes(2);
  });

  it("filters non-markdown files and keeps only .md / .markdown (case-insensitive)", async () => {
    const metas = new Map<string, TerminalMeta>([["p1", makeMeta("/work")]]);
    searchTreeMock.mockResolvedValue({
      ok: true,
      entries: [
        {
          name: "a.md",
          path: "/work/a.md",
          isDirectory: false,
          isSymlink: false,
        },
        {
          name: "b.MD",
          path: "/work/b.MD",
          isDirectory: false,
          isSymlink: false,
        },
        {
          name: "c.markdown",
          path: "/work/c.markdown",
          isDirectory: false,
          isSymlink: false,
        },
        {
          name: "d.txt",
          path: "/work/d.txt",
          isDirectory: false,
          isSymlink: false,
        },
        {
          name: "subdir",
          path: "/work/subdir",
          isDirectory: true,
          isSymlink: false,
        },
      ],
      truncated: false,
    });
    const result = await listMarkdownFilesAcrossPanes(metas, "");
    const paths = result.entries.map((e) => e.path);
    expect(paths).toEqual(["/work/a.md", "/work/b.MD", "/work/c.markdown"]);
  });

  it("deduplicates files by absolute path across cwds", async () => {
    const metas = new Map<string, TerminalMeta>([
      ["p1", makeMeta("/a")],
      ["p2", makeMeta("/b")],
    ]);
    // 両 cwd の検索結果に同じ /shared/x.md が含まれる
    searchTreeMock.mockResolvedValue({
      ok: true,
      entries: [
        {
          name: "x.md",
          path: "/shared/x.md",
          isDirectory: false,
          isSymlink: false,
        },
      ],
      truncated: false,
    });
    const result = await listMarkdownFilesAcrossPanes(metas, "");
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].path).toBe("/shared/x.md");
  });

  it("applies query as substring filter on file name (case-insensitive)", async () => {
    const metas = new Map<string, TerminalMeta>([["p1", makeMeta("/work")]]);
    searchTreeMock.mockResolvedValue({
      ok: true,
      entries: [
        {
          name: "README.md",
          path: "/work/README.md",
          isDirectory: false,
          isSymlink: false,
        },
        {
          name: "notes.md",
          path: "/work/notes.md",
          isDirectory: false,
          isSymlink: false,
        },
        {
          name: "todo.md",
          path: "/work/todo.md",
          isDirectory: false,
          isSymlink: false,
        },
      ],
      truncated: false,
    });
    const result = await listMarkdownFilesAcrossPanes(metas, "ME");
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].path).toBe("/work/README.md");
  });

  it("caps results at 50 entries and sets truncated=true", async () => {
    const metas = new Map<string, TerminalMeta>([["p1", makeMeta("/work")]]);
    const entries = Array.from({ length: 100 }, (_, i) => ({
      name: `f${i}.md`,
      path: `/work/f${i}.md`,
      isDirectory: false,
      isSymlink: false,
    }));
    searchTreeMock.mockResolvedValue({ ok: true, entries, truncated: false });
    const result = await listMarkdownFilesAcrossPanes(metas, "");
    expect(result.entries.length).toBe(50);
    expect(result.truncated).toBe(true);
  });

  it("propagates searchTree truncated flag even if under 50 results", async () => {
    const metas = new Map<string, TerminalMeta>([["p1", makeMeta("/work")]]);
    searchTreeMock.mockResolvedValue({
      ok: true,
      entries: [
        {
          name: "a.md",
          path: "/work/a.md",
          isDirectory: false,
          isSymlink: false,
        },
      ],
      truncated: true, // searchTree 側で打ち切られた
    });
    const result = await listMarkdownFilesAcrossPanes(metas, "");
    expect(result.entries.length).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it("ignores searchTree errors and returns whatever succeeded", async () => {
    const metas = new Map<string, TerminalMeta>([
      ["p1", makeMeta("/ok")],
      ["p2", makeMeta("/bad")],
    ]);
    searchTreeMock.mockImplementation((cwd: string) => {
      if (cwd === "/bad")
        return Promise.resolve({ ok: false, error: "permission denied" });
      return Promise.resolve({
        ok: true,
        entries: [
          {
            name: "good.md",
            path: "/ok/good.md",
            isDirectory: false,
            isSymlink: false,
          },
        ],
        truncated: false,
      });
    });
    const result = await listMarkdownFilesAcrossPanes(metas, "");
    expect(result.entries.map((e) => e.path)).toEqual(["/ok/good.md"]);
  });
});
