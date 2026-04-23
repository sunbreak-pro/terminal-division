import { describe, it, expect, beforeEach, vi } from "vitest";
import { formatPaths, promptAndInsertFiles } from "../insertFiles";

vi.mock("../../services/terminalManager", () => ({
  focus: vi.fn(),
}));

import * as terminalManager from "../../services/terminalManager";

describe("formatPaths", () => {
  it("returns raw path when no space or quote", () => {
    expect(formatPaths(["/Users/foo/bar.png"])).toBe("/Users/foo/bar.png");
  });

  it("wraps path containing space in double quotes", () => {
    expect(formatPaths(["/Users/foo/my folder/x.png"])).toBe(
      '"/Users/foo/my folder/x.png"',
    );
  });

  it("escapes embedded double quotes and wraps", () => {
    expect(formatPaths(['/Users/foo/weird"name.png'])).toBe(
      '"/Users/foo/weird\\"name.png"',
    );
  });

  it("joins multiple paths with a single space separator", () => {
    expect(formatPaths(["/a/b.png", "/c/d e.png", "/f/g.png"])).toBe(
      '/a/b.png "/c/d e.png" /f/g.png',
    );
  });

  it("returns empty string for empty input", () => {
    expect(formatPaths([])).toBe("");
  });
});

describe("promptAndInsertFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes formatted paths to PTY and refocuses when files are selected", async () => {
    vi.mocked(window.api.dialog.selectFiles).mockResolvedValueOnce([
      "/a/b.png",
      "/c/d e.png",
    ]);

    await promptAndInsertFiles("term-1");

    expect(window.api.pty.write).toHaveBeenCalledWith(
      "term-1",
      '/a/b.png "/c/d e.png"',
    );
    expect(terminalManager.focus).toHaveBeenCalledWith("term-1");
  });

  it("does not write when dialog is canceled (null) but still refocuses", async () => {
    vi.mocked(window.api.dialog.selectFiles).mockResolvedValueOnce(null);

    await promptAndInsertFiles("term-1");

    expect(window.api.pty.write).not.toHaveBeenCalled();
    expect(terminalManager.focus).toHaveBeenCalledWith("term-1");
  });

  it("does not write when selection is empty", async () => {
    vi.mocked(window.api.dialog.selectFiles).mockResolvedValueOnce([]);

    await promptAndInsertFiles("term-1");

    expect(window.api.pty.write).not.toHaveBeenCalled();
    expect(terminalManager.focus).toHaveBeenCalledWith("term-1");
  });

  it("logs and swallows dialog errors without crashing", async () => {
    vi.mocked(window.api.dialog.selectFiles).mockRejectedValueOnce(
      new Error("boom"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await promptAndInsertFiles("term-1");

    expect(consoleError).toHaveBeenCalled();
    expect(window.api.pty.write).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
