import { describe, it, expect, beforeEach } from "vitest";
import { usePathHoverStore } from "../pathHoverStore";

describe("pathHoverStore", () => {
  beforeEach(() => {
    // 各テスト前に初期状態に戻す
    usePathHoverStore.setState({
      visible: false,
      text: "",
      x: 0,
      y: 0,
    });
  });

  it("初期状態は不可視", () => {
    expect(usePathHoverStore.getState().visible).toBe(false);
    expect(usePathHoverStore.getState().text).toBe("");
  });

  it("show で text/x/y がセットされ visible: true になる", () => {
    usePathHoverStore.getState().show("/foo/bar.ts", 100, 200);
    const s = usePathHoverStore.getState();
    expect(s.visible).toBe(true);
    expect(s.text).toBe("/foo/bar.ts");
    expect(s.x).toBe(100);
    expect(s.y).toBe(200);
  });

  it("hide で visible: false に戻る (text/x/y は維持)", () => {
    usePathHoverStore.getState().show("/foo/bar.ts", 100, 200);
    usePathHoverStore.getState().hide();
    const s = usePathHoverStore.getState();
    expect(s.visible).toBe(false);
    // hide は visible のみ false にし、最後の text/位置は残しておく (連続 show の安定化)
    expect(s.text).toBe("/foo/bar.ts");
    expect(s.x).toBe(100);
    expect(s.y).toBe(200);
  });

  it("連続 show で最新の値で上書きされる", () => {
    usePathHoverStore.getState().show("/a.ts", 10, 20);
    usePathHoverStore.getState().show("/b.ts", 50, 60);
    const s = usePathHoverStore.getState();
    expect(s.text).toBe("/b.ts");
    expect(s.x).toBe(50);
    expect(s.y).toBe(60);
    expect(s.visible).toBe(true);
  });
});
