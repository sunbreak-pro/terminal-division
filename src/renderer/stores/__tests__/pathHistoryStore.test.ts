import { beforeEach, describe, expect, it } from "vitest";
import { usePathHistoryStore } from "../pathHistoryStore";

const PANE = "pane-test";

beforeEach(() => {
  // 各テスト前に全ペインの状態をクリア
  usePathHistoryStore.setState({ byPane: new Map() });
});

describe("pathHistoryStore", () => {
  it("追加した順に entries が積まれ、count は 1 になる", () => {
    const { addPath, getEntries } = usePathHistoryStore.getState();
    addPath(PANE, "/usr/local/bin", "absolute");
    addPath(PANE, "./src/main.ts", "relative");
    const entries = getEntries(PANE);
    expect(entries.map((e) => e.raw)).toEqual([
      "/usr/local/bin",
      "./src/main.ts",
    ]);
    expect(entries.every((e) => e.count === 1)).toBe(true);
  });

  it("同一パスを再度 add すると count が増え、新規エントリは作らない", () => {
    const { addPath, getEntries } = usePathHistoryStore.getState();
    addPath(PANE, "/a/b/c", "absolute");
    addPath(PANE, "/a/b/c", "absolute");
    addPath(PANE, "/a/b/c", "absolute");
    const entries = getEntries(PANE);
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(3);
  });

  it("末尾スラッシュの有無は同一視する", () => {
    const { addPath, getEntries } = usePathHistoryStore.getState();
    addPath(PANE, "/foo/bar", "absolute");
    addPath(PANE, "/foo/bar/", "absolute");
    expect(getEntries(PANE)).toHaveLength(1);
  });

  it("空文字や 1024 文字超は無視する", () => {
    const { addPath, getEntries } = usePathHistoryStore.getState();
    addPath(PANE, "", "absolute");
    addPath(PANE, "x".repeat(1025), "absolute");
    expect(getEntries(PANE)).toHaveLength(0);
  });

  it("ペインを跨いで履歴は混ざらない", () => {
    const { addPath, getEntries } = usePathHistoryStore.getState();
    addPath("pane-a", "/a", "absolute");
    addPath("pane-b", "/b", "absolute");
    expect(getEntries("pane-a").map((e) => e.raw)).toEqual(["/a"]);
    expect(getEntries("pane-b").map((e) => e.raw)).toEqual(["/b"]);
  });

  it("removePane で当該ペインの履歴が消える", () => {
    const { addPath, removePane, getEntries } = usePathHistoryStore.getState();
    addPath(PANE, "/x", "absolute");
    removePane(PANE);
    expect(getEntries(PANE)).toEqual([]);
  });

  it("clearPane は空配列をセットする", () => {
    const { addPath, clearPane, getEntries } = usePathHistoryStore.getState();
    addPath(PANE, "/x", "absolute");
    addPath(PANE, "/y", "absolute");
    clearPane(PANE);
    expect(getEntries(PANE)).toEqual([]);
  });
});
