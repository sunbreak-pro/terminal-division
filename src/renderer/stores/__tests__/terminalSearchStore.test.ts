import { beforeEach, describe, expect, it } from "vitest";
import { useTerminalSearchStore } from "../terminalSearchStore";

beforeEach(() => {
  useTerminalSearchStore.setState({ openPaneId: null });
});

describe("terminalSearchStore", () => {
  it("初期状態は閉じている", () => {
    expect(useTerminalSearchStore.getState().openPaneId).toBeNull();
  });

  it("open で対象ペインがオープン状態になる", () => {
    useTerminalSearchStore.getState().open("pane-1");
    expect(useTerminalSearchStore.getState().openPaneId).toBe("pane-1");
  });

  it("close で常に null に戻る", () => {
    useTerminalSearchStore.getState().open("pane-1");
    useTerminalSearchStore.getState().close();
    expect(useTerminalSearchStore.getState().openPaneId).toBeNull();
  });

  it("toggle: 同一ペインの 2 回呼び出しで開閉が切り替わる", () => {
    const { toggle } = useTerminalSearchStore.getState();
    toggle("pane-1");
    expect(useTerminalSearchStore.getState().openPaneId).toBe("pane-1");
    toggle("pane-1");
    expect(useTerminalSearchStore.getState().openPaneId).toBeNull();
  });

  it("toggle: 別ペインへ切り替えるとそのペインに付け替わる", () => {
    const { toggle } = useTerminalSearchStore.getState();
    toggle("pane-1");
    toggle("pane-2");
    expect(useTerminalSearchStore.getState().openPaneId).toBe("pane-2");
  });
});
