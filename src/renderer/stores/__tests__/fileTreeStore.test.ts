import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileTreeStore } from "../fileTreeStore";
import { useSidebarStore } from "../sidebarStore";

// window.api.fs.readDir をモック
const mockReadDir = vi.fn();
beforeEach(() => {
  mockReadDir.mockReset();
  // jsdom 環境向けに window.api.fs を都度差し込む
  (window as unknown as { api: { fs: { readDir: typeof mockReadDir } } }).api =
    {
      fs: { readDir: mockReadDir },
    };
  useFileTreeStore.setState({
    dirs: new Map(),
    watchRefCounts: new Map(),
  });
  useSidebarStore.setState({ expandedPaths: new Set() });
});

describe("fileTreeStore.refreshAllExpanded", () => {
  it("ルート + 当該ルート配下の展開中パスを並列にロードする", async () => {
    mockReadDir.mockResolvedValue({ ok: true, entries: [] });
    useSidebarStore.setState({
      expandedPaths: new Set([
        "/root/a",
        "/root/a/b",
        "/other/x", // 別ルート配下は対象外
      ]),
    });

    await useFileTreeStore.getState().refreshAllExpanded("/root");

    const calledPaths = mockReadDir.mock.calls
      .map((call) => call[0] as string)
      .sort();
    expect(calledPaths).toEqual(["/root", "/root/a", "/root/a/b"]);
  });

  it("展開中パスがゼロでもルート単体は読み直す", async () => {
    mockReadDir.mockResolvedValue({ ok: true, entries: [] });
    await useFileTreeStore.getState().refreshAllExpanded("/empty-root");
    expect(mockReadDir).toHaveBeenCalledTimes(1);
    expect(mockReadDir).toHaveBeenCalledWith("/empty-root");
  });

  it("/root の prefix にマッチしても異なる兄弟パスは含めない", async () => {
    // "/root-other" は "/root" + "/" で始まらないので含まれない
    mockReadDir.mockResolvedValue({ ok: true, entries: [] });
    useSidebarStore.setState({
      expandedPaths: new Set(["/root-other/foo", "/root/keep"]),
    });
    await useFileTreeStore.getState().refreshAllExpanded("/root");
    const calledPaths = mockReadDir.mock.calls
      .map((call) => call[0] as string)
      .sort();
    expect(calledPaths).toEqual(["/root", "/root/keep"]);
  });
});
