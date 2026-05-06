import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePinnedDirsStore } from "../pinnedDirsStore";

// window.api.pinnedDirs は test/setup.ts でモック済み (resolves true / [])。
// 個別テスト内で挙動を上書きする。

const getMock = (): ReturnType<typeof vi.fn> =>
  window.api.pinnedDirs.get as unknown as ReturnType<typeof vi.fn>;
const addMock = (): ReturnType<typeof vi.fn> =>
  window.api.pinnedDirs.add as unknown as ReturnType<typeof vi.fn>;
const removeMock = (): ReturnType<typeof vi.fn> =>
  window.api.pinnedDirs.remove as unknown as ReturnType<typeof vi.fn>;

const resetStore = (): void => {
  usePinnedDirsStore.setState({ paths: [], initialized: false });
};

describe("pinnedDirsStore", () => {
  beforeEach(() => {
    resetStore();
    getMock().mockReset().mockResolvedValue([]);
    addMock().mockReset().mockResolvedValue(true);
    removeMock().mockReset().mockResolvedValue(true);
  });

  it("init で IPC からロードして state にセットする", async () => {
    getMock().mockResolvedValueOnce(["/a", "/b"]);
    await usePinnedDirsStore.getState().init();
    expect(usePinnedDirsStore.getState().paths).toEqual(["/a", "/b"]);
    expect(usePinnedDirsStore.getState().initialized).toBe(true);
  });

  it("init は二重呼び出ししない", async () => {
    getMock().mockResolvedValue(["/x"]);
    await usePinnedDirsStore.getState().init();
    await usePinnedDirsStore.getState().init();
    expect(getMock()).toHaveBeenCalledTimes(1);
  });

  it("add は楽観更新し IPC 成功で確定する", async () => {
    addMock().mockResolvedValueOnce(true);
    const ok = await usePinnedDirsStore.getState().add("/foo");
    expect(ok).toBe(true);
    expect(usePinnedDirsStore.getState().paths).toEqual(["/foo"]);
  });

  it("既に登録済みなら add は false (state 変化なし)", async () => {
    usePinnedDirsStore.setState({ paths: ["/foo"], initialized: true });
    const ok = await usePinnedDirsStore.getState().add("/foo");
    expect(ok).toBe(false);
    expect(addMock()).not.toHaveBeenCalled();
  });

  it("IPC が false を返すと add 後に rollback される", async () => {
    addMock().mockResolvedValueOnce(false);
    const ok = await usePinnedDirsStore.getState().add("/bad");
    expect(ok).toBe(false);
    expect(usePinnedDirsStore.getState().paths).toEqual([]);
  });

  it("remove は state を更新し IPC を呼ぶ", async () => {
    usePinnedDirsStore.setState({
      paths: ["/a", "/b", "/c"],
      initialized: true,
    });
    const ok = await usePinnedDirsStore.getState().remove("/b");
    expect(ok).toBe(true);
    expect(usePinnedDirsStore.getState().paths).toEqual(["/a", "/c"]);
    expect(removeMock()).toHaveBeenCalledWith("/b");
  });

  it("未登録パスの remove は false (IPC を呼ばない)", async () => {
    const ok = await usePinnedDirsStore.getState().remove("/nope");
    expect(ok).toBe(false);
    expect(removeMock()).not.toHaveBeenCalled();
  });

  it("IPC の reject 時は rollback する (add)", async () => {
    addMock().mockRejectedValueOnce(new Error("IPC fail"));
    const ok = await usePinnedDirsStore.getState().add("/x");
    expect(ok).toBe(false);
    expect(usePinnedDirsStore.getState().paths).toEqual([]);
  });
});
