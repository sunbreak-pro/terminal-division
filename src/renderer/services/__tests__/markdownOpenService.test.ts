import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// fs.readFile / openMarkdown / setOpen の呼び出しを観測するためのモック
const readFileMock = vi.fn();
const openMarkdownMock = vi.fn();
const setOpenMock = vi.fn();

vi.stubGlobal("window", {
  api: {
    fs: {
      readFile: (...args: unknown[]) => readFileMock(...args),
    },
  },
});

vi.mock("../../stores/markdownTabsStore", () => ({
  useMarkdownTabsStore: {
    getState: () => ({
      openMarkdown: (...args: unknown[]) => openMarkdownMock(...args),
    }),
  },
}));

vi.mock("../../stores/rightSidebarStore", () => ({
  useRightSidebarStore: {
    getState: () => ({
      setOpen: (...args: unknown[]) => setOpenMock(...args),
    }),
  },
}));

vi.mock("../../components/Sidebar/ErrorToast", () => ({
  showErrorToast: vi.fn(),
}));

import { openMarkdownInRightSidebar } from "../markdownOpenService";
import { showErrorToast } from "../../components/Sidebar/ErrorToast";

describe("openMarkdownInRightSidebar", () => {
  beforeEach(() => {
    readFileMock.mockReset();
    openMarkdownMock.mockReset();
    setOpenMock.mockReset();
    openMarkdownMock.mockReturnValue({
      ok: true,
      tabId: "t1",
      existed: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads file content and opens it in the markdown tabs store", async () => {
    readFileMock.mockResolvedValue({ ok: true, content: "# hi" });
    await openMarkdownInRightSidebar("/work/foo.md");
    expect(readFileMock).toHaveBeenCalledWith("/work/foo.md");
    expect(openMarkdownMock).toHaveBeenCalledWith("/work/foo.md", "# hi");
  });

  it("auto-opens the right sidebar when a file is opened", async () => {
    readFileMock.mockResolvedValue({ ok: true, content: "" });
    await openMarkdownInRightSidebar("/a.md");
    expect(setOpenMock).toHaveBeenCalledWith(true);
  });

  it("does nothing for non-markdown paths", async () => {
    await openMarkdownInRightSidebar("/some/file.txt");
    expect(readFileMock).not.toHaveBeenCalled();
    expect(openMarkdownMock).not.toHaveBeenCalled();
    expect(setOpenMock).not.toHaveBeenCalled();
  });

  it("does not auto-open the sidebar if the tab limit is reached", async () => {
    readFileMock.mockResolvedValue({ ok: true, content: "" });
    openMarkdownMock.mockReturnValue({ ok: false, reason: "limit" });
    await openMarkdownInRightSidebar("/x.md");
    expect(setOpenMock).not.toHaveBeenCalled();
  });

  it("does not call openMarkdown when readFile fails", async () => {
    readFileMock.mockResolvedValue({ ok: false, error: "ENOENT" });
    await openMarkdownInRightSidebar("/missing.md");
    expect(openMarkdownMock).not.toHaveBeenCalled();
    expect(setOpenMock).not.toHaveBeenCalled();
  });

  it("shows a friendly toast (basename only) when ENOENT is returned", async () => {
    readFileMock.mockResolvedValue({
      ok: false,
      error:
        "ENOENT: no such file or directory, stat '/Users/x/learning/foo.md'",
    });
    await openMarkdownInRightSidebar("/Users/x/learning/foo.md");
    expect(showErrorToast).toHaveBeenCalledWith(
      "ファイルが見つかりません: foo.md",
    );
  });

  it("falls back to the raw error for non-ENOENT failures", async () => {
    readFileMock.mockResolvedValue({
      ok: false,
      error: "EACCES: permission denied",
    });
    await openMarkdownInRightSidebar("/restricted.md");
    expect(showErrorToast).toHaveBeenCalledWith(
      "ファイル読込に失敗しました: EACCES: permission denied",
    );
  });
});
