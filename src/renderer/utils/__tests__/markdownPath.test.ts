import { describe, it, expect } from "vitest";
import {
  findMarkdownPaths,
  findPaths,
  resolveMarkdownPath,
  isInsideCwd,
} from "../markdownPath";

describe("findMarkdownPaths", () => {
  it("detects absolute Unix path with .md extension", () => {
    const r = findMarkdownPaths("see /Users/foo/bar/README.md for details");
    expect(r).toHaveLength(1);
    expect(r[0].raw).toBe("/Users/foo/bar/README.md");
    expect(r[0].start).toBe(4);
    expect(r[0].end).toBe(28);
  });

  it("detects tilde-prefixed path", () => {
    const r = findMarkdownPaths("open ~/dev/notes/foo.md please");
    expect(r).toHaveLength(1);
    expect(r[0].raw).toBe("~/dev/notes/foo.md");
  });

  it("detects ./ and ../ relative paths", () => {
    expect(findMarkdownPaths("cat ./README.md")[0].raw).toBe("./README.md");
    expect(findMarkdownPaths("cat ../docs/setup.md")[0].raw).toBe(
      "../docs/setup.md",
    );
  });

  it("detects simple filename and dir/file forms", () => {
    expect(findMarkdownPaths("vim README.md")[0].raw).toBe("README.md");
    expect(findMarkdownPaths("cat docs/setup.md")[0].raw).toBe("docs/setup.md");
  });

  it("matches .markdown extension", () => {
    const r = findMarkdownPaths("see /tmp/foo.markdown");
    expect(r).toHaveLength(1);
    expect(r[0].raw).toBe("/tmp/foo.markdown");
  });

  it("is case-insensitive on extension", () => {
    expect(findMarkdownPaths("README.MD")[0].raw).toBe("README.MD");
  });

  it("strips trailing punctuation", () => {
    const r = findMarkdownPaths("Edit ~/notes.md, then commit.");
    expect(r[0].raw).toBe("~/notes.md");
  });

  it("excludes URLs that contain .md", () => {
    const r = findMarkdownPaths("check https://example.com/foo.md page");
    expect(r).toHaveLength(0);
  });

  it("returns empty for plain text without paths", () => {
    expect(findMarkdownPaths("hello world")).toEqual([]);
    expect(findMarkdownPaths("")).toEqual([]);
  });

  it("detects multiple matches on a single line", () => {
    const r = findMarkdownPaths("diff README.md vs ./docs/old.md output");
    expect(r).toHaveLength(2);
    expect(r.map((m) => m.raw)).toEqual(["README.md", "./docs/old.md"]);
  });

  it("does not match files without .md extension", () => {
    expect(findMarkdownPaths("foo.txt and bar/baz.json")).toEqual([]);
  });
});

describe("resolveMarkdownPath", () => {
  it("expands ~ to home dir", () => {
    expect(resolveMarkdownPath("~/foo.md", null, "/Users/me")).toBe(
      "/Users/me/foo.md",
    );
    expect(resolveMarkdownPath("~", null, "/Users/me")).toBe("/Users/me");
  });

  it("returns absolute paths unchanged (normalized)", () => {
    expect(resolveMarkdownPath("/abs/foo.md", "/cwd", "/h")).toBe(
      "/abs/foo.md",
    );
    expect(resolveMarkdownPath("/abs//foo/./bar.md", "/cwd", "/h")).toBe(
      "/abs/foo/bar.md",
    );
  });

  it("resolves relative paths against cwd", () => {
    expect(resolveMarkdownPath("foo.md", "/work", "/h")).toBe("/work/foo.md");
    expect(resolveMarkdownPath("./foo.md", "/work", "/h")).toBe("/work/foo.md");
    expect(resolveMarkdownPath("../foo.md", "/work/sub", "/h")).toBe(
      "/work/foo.md",
    );
    expect(resolveMarkdownPath("dir/foo.md", "/work", "/h")).toBe(
      "/work/dir/foo.md",
    );
  });

  it("returns null for relative paths when cwd is missing", () => {
    expect(resolveMarkdownPath("foo.md", null, "/h")).toBeNull();
  });

  it("returns null for tilde when home is empty", () => {
    expect(resolveMarkdownPath("~/foo.md", "/cwd", "")).toBeNull();
  });

  it("does not let ../ escape root", () => {
    expect(resolveMarkdownPath("../../../etc.md", "/", "/h")).toBe("/etc.md");
  });
});

describe("isInsideCwd", () => {
  it("is true when paths are equal", () => {
    expect(isInsideCwd("/work/foo", "/work/foo")).toBe(true);
  });

  it("is true when path is inside cwd", () => {
    expect(isInsideCwd("/work/foo/bar.md", "/work")).toBe(true);
    expect(isInsideCwd("/work/sub/dir/file.md", "/work/sub")).toBe(true);
  });

  it("is false when path is outside cwd", () => {
    expect(isInsideCwd("/other/foo.md", "/work")).toBe(false);
  });

  it("is false when prefix matches but boundary differs", () => {
    // /work-foo は /work の配下ではない
    expect(isInsideCwd("/work-foo/bar.md", "/work")).toBe(false);
  });

  it("is false when cwd is null", () => {
    expect(isInsideCwd("/any/foo.md", null)).toBe(false);
  });
});

describe("findPaths", () => {
  it("既存の md パスは kind='md' で返される", () => {
    const r = findPaths("see /Users/foo/bar/README.md please");
    expect(r).toHaveLength(1);
    expect(r[0].raw).toBe("/Users/foo/bar/README.md");
    expect(r[0].kind).toBe("md");
  });

  it(".md 以外の絶対パスは kind='path'", () => {
    const r = findPaths("opening /Users/foo/script.sh now");
    expect(r).toHaveLength(1);
    expect(r[0].raw).toBe("/Users/foo/script.sh");
    expect(r[0].kind).toBe("path");
  });

  it("チルダ表記も検出する", () => {
    const r = findPaths("cat ~/.zshrc");
    expect(r).toHaveLength(1);
    expect(r[0].raw).toBe("~/.zshrc");
    expect(r[0].kind).toBe("path");
  });

  it("相対パス (./ ../) も検出する", () => {
    const r = findPaths("vim ./src/index.ts");
    expect(r).toHaveLength(1);
    expect(r[0].raw).toBe("./src/index.ts");
    expect(r[0].kind).toBe("path");
  });

  it("dir/file 形式も検出する", () => {
    const r = findPaths("see src/components/App.tsx");
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0].raw).toBe("src/components/App.tsx");
    expect(r[0].kind).toBe("path");
  });

  it("URL 範囲は除外する", () => {
    // https://example.com/foo.md は WebLinksAddon が拾う領分
    const r = findPaths("docs at https://example.com/foo.md available");
    expect(r).toHaveLength(0);
  });

  it("md と他のパスを混在検出できる", () => {
    const r = findPaths("docs: ~/notes/foo.md and config /etc/zshrc");
    expect(r).toHaveLength(2);
    const md = r.find((m) => m.kind === "md");
    const path = r.find((m) => m.kind === "path");
    expect(md?.raw).toBe("~/notes/foo.md");
    expect(path?.raw).toBe("/etc/zshrc");
  });

  it("単独の単語 (path セパレータ無し) は検出しない", () => {
    expect(findPaths("hello world foo bar")).toEqual([]);
  });

  it("末尾の句読点を切り落とす", () => {
    const r = findPaths("see /etc/foo.conf, then /etc/bar.conf.");
    expect(r).toHaveLength(2);
    expect(r[0].raw).toBe("/etc/foo.conf");
    expect(r[1].raw).toBe("/etc/bar.conf");
  });

  it("md が同範囲を被覆していれば md を優先 (path 化されない)", () => {
    const r = findPaths("file ~/notes/foo.md ok");
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("md");
  });

  it("空行は空配列", () => {
    expect(findPaths("")).toEqual([]);
  });
});
