import { describe, it, expect } from "vitest";
import { isMarkdownPath, getFileName } from "../markdownFile";

describe("isMarkdownPath", () => {
  it("returns true for .md extension (lowercase)", () => {
    expect(isMarkdownPath("/foo/bar.md")).toBe(true);
  });

  it("returns true for .markdown extension (lowercase)", () => {
    expect(isMarkdownPath("/foo/bar.markdown")).toBe(true);
  });

  it("is case-insensitive (.MD)", () => {
    expect(isMarkdownPath("/foo/README.MD")).toBe(true);
  });

  it("is case-insensitive (.MarkDown)", () => {
    expect(isMarkdownPath("/foo/notes.MarkDown")).toBe(true);
  });

  it("returns false for .txt", () => {
    expect(isMarkdownPath("/foo/bar.txt")).toBe(false);
  });

  it("returns false for .ts (substring of .markdown but distinct extension)", () => {
    expect(isMarkdownPath("/foo/bar.ts")).toBe(false);
  });

  it("returns false for files without extension", () => {
    expect(isMarkdownPath("/foo/README")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isMarkdownPath("")).toBe(false);
  });

  it("returns false for non-string input", () => {
    // 型ガードを兼ねる: 実装は typeof チェック後 false を返す
    expect(isMarkdownPath(undefined as unknown as string)).toBe(false);
    expect(isMarkdownPath(null as unknown as string)).toBe(false);
  });

  it("treats '.md' as a leading-dot file (no name) — extension check matches", () => {
    // 末尾がそのまま .md なので true (実害はない: ファイル名 .md は OS 上珍しいが許容)
    expect(isMarkdownPath(".md")).toBe(true);
  });

  it("returns false when dot is the last char (no extension after)", () => {
    expect(isMarkdownPath("/foo/bar.")).toBe(false);
  });

  it("handles path containing dots in directories", () => {
    expect(isMarkdownPath("/Users/foo.bar/notes.md")).toBe(true);
    expect(isMarkdownPath("/Users/foo.bar/notes.txt")).toBe(false);
  });
});

describe("getFileName", () => {
  it("returns last segment of POSIX path", () => {
    expect(getFileName("/Users/foo/bar.md")).toBe("bar.md");
  });

  it("returns the entire string when no slash present", () => {
    expect(getFileName("bar.md")).toBe("bar.md");
  });

  it("returns empty string for trailing slash", () => {
    expect(getFileName("/Users/foo/")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(getFileName("")).toBe("");
  });

  it("returns empty string for non-string input", () => {
    expect(getFileName(undefined as unknown as string)).toBe("");
  });
});
