import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// file-system-handler.ts は electron / chokidar を import するため、副作用を避けるため
// 最小限のモックを差し込む。searchTree 自体は fs.promises のみ使うので、本物の
// 一時ディレクトリで検証する。
vi.mock("electron", () => ({
  BrowserWindow: { fromId: vi.fn() },
  shell: { trashItem: vi.fn(), openExternal: vi.fn() },
}));
vi.mock("chokidar", () => ({
  default: { watch: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })) },
}));

import { fileSystemManager } from "../file-system-handler";

describe("fileSystemManager.searchTree", () => {
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "td-search-test-"),
    );
    // 検索テスト用のディレクトリツリーを構築
    //   tmpRoot/
    //     README.md
    //     src/
    //       app.ts
    //     .claude/
    //       MEMORY.md
    //       HISTORY.md
    //     node_modules/   <- スキップされるはず
    //       memory-cache.js
    //     deep/a/b/c/
    //       deep-memory.txt
    await fs.promises.writeFile(path.join(tmpRoot, "README.md"), "");
    await fs.promises.mkdir(path.join(tmpRoot, "src"));
    await fs.promises.writeFile(path.join(tmpRoot, "src", "app.ts"), "");
    await fs.promises.mkdir(path.join(tmpRoot, ".claude"));
    await fs.promises.writeFile(path.join(tmpRoot, ".claude", "MEMORY.md"), "");
    await fs.promises.writeFile(
      path.join(tmpRoot, ".claude", "HISTORY.md"),
      "",
    );
    await fs.promises.mkdir(path.join(tmpRoot, "node_modules"));
    await fs.promises.writeFile(
      path.join(tmpRoot, "node_modules", "memory-cache.js"),
      "",
    );
    await fs.promises.mkdir(path.join(tmpRoot, "deep", "a", "b", "c"), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(tmpRoot, "deep", "a", "b", "c", "deep-memory.txt"),
      "",
    );
  });

  afterAll(async () => {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  });

  it("ルート直下のファイルにマッチする", async () => {
    const { entries, truncated } = await fileSystemManager.searchTree(
      tmpRoot,
      "README",
    );
    expect(truncated).toBe(false);
    const names = entries.map((e) => e.name);
    expect(names).toContain("README.md");
  });

  it("サブディレクトリ内のファイルにも再帰的にマッチする (.claude/MEMORY.md)", async () => {
    const { entries } = await fileSystemManager.searchTree(tmpRoot, "MEMORY");
    const paths = entries.map((e) => e.path);
    // ドットフォルダ (.claude) も探索対象
    expect(paths).toContain(path.join(tmpRoot, ".claude", "MEMORY.md"));
  });

  it("大文字小文字を区別せずに部分一致する", async () => {
    const { entries } = await fileSystemManager.searchTree(tmpRoot, "me");
    const names = entries.map((e) => e.name);
    expect(names).toContain("MEMORY.md");
    // "ME" は README.md にも含まれる
    expect(names).toContain("README.md");
  });

  it("node_modules はスキップされる", async () => {
    const { entries } = await fileSystemManager.searchTree(tmpRoot, "memory");
    const paths = entries.map((e) => e.path);
    // .claude/MEMORY.md はマッチするが node_modules/memory-cache.js はマッチしない
    expect(paths).toContain(path.join(tmpRoot, ".claude", "MEMORY.md"));
    expect(paths).not.toContain(
      path.join(tmpRoot, "node_modules", "memory-cache.js"),
    );
  });

  it("深い階層にあるファイルもマッチする", async () => {
    const { entries } = await fileSystemManager.searchTree(
      tmpRoot,
      "deep-memory",
    );
    const paths = entries.map((e) => e.path);
    expect(paths).toContain(
      path.join(tmpRoot, "deep", "a", "b", "c", "deep-memory.txt"),
    );
  });

  it("空クエリ・空白のみのクエリは空配列を返す", async () => {
    const empty = await fileSystemManager.searchTree(tmpRoot, "");
    expect(empty.entries).toEqual([]);
    expect(empty.truncated).toBe(false);
    const blank = await fileSystemManager.searchTree(tmpRoot, "   ");
    expect(blank.entries).toEqual([]);
  });

  it("maxResults を超えると truncated=true で打ち切られる", async () => {
    const { entries, truncated } = await fileSystemManager.searchTree(
      tmpRoot,
      "m", // m を含むファイルが複数ある
      { maxResults: 2 },
    );
    expect(entries.length).toBeLessThanOrEqual(2);
    expect(truncated).toBe(true);
  });

  it("maxDepth を超える深い階層は探索しない", async () => {
    // deep/a/b/c は深度 4。maxDepth=2 なら deep-memory.txt は見つからない
    const { entries } = await fileSystemManager.searchTree(
      tmpRoot,
      "deep-memory",
      { maxDepth: 2 },
    );
    expect(entries).toEqual([]);
  });

  it("isDirectory / isSymlink フラグが正しく付与される", async () => {
    const { entries } = await fileSystemManager.searchTree(tmpRoot, "src");
    const srcEntry = entries.find((e) => e.name === "src");
    expect(srcEntry).toBeDefined();
    expect(srcEntry?.isDirectory).toBe(true);
    expect(srcEntry?.isSymlink).toBe(false);

    const memoryEntry = entries.find((e) => e.name === "MEMORY.md");
    // search query "src" だけだと MEMORY.md はマッチしないので、別検索
    const { entries: memEntries } = await fileSystemManager.searchTree(
      tmpRoot,
      "MEMORY",
    );
    const mem = memEntries.find((e) => e.name === "MEMORY.md");
    expect(mem?.isDirectory).toBe(false);
    expect(mem?.isSymlink).toBe(false);
    void memoryEntry; // 未使用警告回避
  });
});
