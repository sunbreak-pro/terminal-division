import { describe, it, expect } from "vitest";
import { filterEntriesByQuery } from "../TreeNode";
import type { FileNode } from "../../../stores/fileTreeStore";

const make = (name: string, isDirectory = false): FileNode => ({
  name,
  path: `/x/${name}`,
  isDirectory,
  isSymlink: false,
});

describe("filterEntriesByQuery", () => {
  const entries: FileNode[] = [
    make("CLAUDE.md"),
    make("HISTORY.md"),
    make(".claude", true),
    make("node_modules", true),
    make("README.md"),
  ];

  it("returns all entries when query is empty", () => {
    expect(filterEntriesByQuery(entries, "")).toBe(entries);
  });

  it("returns all entries when query is whitespace only", () => {
    expect(filterEntriesByQuery(entries, "   ")).toBe(entries);
  });

  it("filters by case-insensitive substring match", () => {
    const result = filterEntriesByQuery(entries, "claude");
    expect(result.map((e) => e.name)).toEqual(["CLAUDE.md", ".claude"]);
  });

  it("matches mixed case input against mixed case names", () => {
    const result = filterEntriesByQuery(entries, "ReAdMe");
    expect(result.map((e) => e.name)).toEqual(["README.md"]);
  });

  it("returns empty array when nothing matches", () => {
    expect(filterEntriesByQuery(entries, "zzz")).toEqual([]);
  });

  it("trims surrounding whitespace from the query", () => {
    const result = filterEntriesByQuery(entries, "  history  ");
    expect(result.map((e) => e.name)).toEqual(["HISTORY.md"]);
  });

  it("matches both files and directories", () => {
    const result = filterEntriesByQuery(entries, ".");
    // dot appears in CLAUDE.md, HISTORY.md, .claude, README.md
    expect(result.map((e) => e.name)).toEqual([
      "CLAUDE.md",
      "HISTORY.md",
      ".claude",
      "README.md",
    ]);
  });
});
