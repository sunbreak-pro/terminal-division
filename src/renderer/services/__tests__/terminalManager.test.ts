import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// xterm.jsとFitAddonのモック (vi.mockのファクトリ内でクラス定義)
vi.mock("@xterm/xterm", () => {
  class MockTerminal {
    loadAddon = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    onData = vi.fn().mockReturnValue({ dispose: vi.fn() });
    focus = vi.fn();
    scrollToBottom = vi.fn();
    resize = vi.fn();
    cols = 80;
    rows = 24;
    element = null;
    buffer = {
      active: {
        cursorY: 0,
        viewportY: 0,
        type: "normal" as "normal" | "alternate",
      },
    };
    selectLines = vi.fn();
    getSelection = vi.fn().mockReturnValue("");
    clearSelection = vi.fn();
    parser = {
      registerOscHandler: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    };
    registerMarker = vi
      .fn()
      .mockReturnValue({ isDisposed: false, dispose: vi.fn() });
    registerDecoration = vi.fn().mockReturnValue(null);
    write = vi.fn();
    options = { theme: {}, fontFamily: "monospace", fontSize: 13 };
  }
  return { Terminal: MockTerminal };
});

vi.mock("@xterm/addon-fit", () => {
  class MockFitAddon {
    fit = vi.fn();
  }
  return { FitAddon: MockFitAddon };
});

vi.mock("@xterm/addon-web-links", () => {
  class MockWebLinksAddon {
    constructor(_handler: unknown) {}
  }
  return { WebLinksAddon: MockWebLinksAddon };
});

vi.mock("../../stores/terminalMetaStore", () => ({
  useTerminalMetaStore: {
    getState: () => ({
      metas: new Map(),
      initMeta: vi.fn(),
      setCwd: vi.fn(),
      setProcessName: vi.fn(),
      setShellName: vi.fn(),
      removeMeta: vi.fn(),
    }),
  },
}));

// window.apiモック
const mockPtyApi = {
  create: vi.fn().mockResolvedValue("mock-pty-id"),
  write: vi.fn(),
  resize: vi.fn(),
  destroy: vi.fn(),
  kill: vi.fn(),
  onData: vi.fn().mockReturnValue(() => {}),
  onExit: vi.fn().mockReturnValue(() => {}),
  onProcessName: vi.fn().mockReturnValue(() => {}),
  onShellName: vi.fn().mockReturnValue(() => {}),
};

const mockShellApi = {
  openExternal: vi.fn(),
};

Object.defineProperty(window, "api", {
  value: {
    pty: mockPtyApi,
    shell: mockShellApi,
  },
  writable: true,
});

// テスト対象をインポート（モックの後にインポート）
import * as terminalManager from "../terminalManager";

describe("terminalManager", () => {
  const defaultOptions = {
    fontSize: 14,
    fontFamily: "monospace",
  };
  const defaultCallbacks = {
    onData: vi.fn(),
    onExit: vi.fn(),
    onFocus: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getOrCreate", () => {
    it("should create a new terminal instance", () => {
      const instance = terminalManager.getOrCreate(
        "test-1",
        defaultOptions,
        defaultCallbacks,
      );

      expect(instance).toBeDefined();
      expect(instance.terminal).toBeDefined();
      expect(instance.fitAddon).toBeDefined();
      expect(instance.ptyCreated).toBe(false);
    });

    it("should return existing instance on subsequent calls", () => {
      const instance1 = terminalManager.getOrCreate(
        "test-2",
        defaultOptions,
        defaultCallbacks,
      );
      const instance2 = terminalManager.getOrCreate(
        "test-2",
        defaultOptions,
        defaultCallbacks,
      );

      expect(instance1).toBe(instance2);
    });

    it("should create separate instances for different ids", () => {
      const instance1 = terminalManager.getOrCreate(
        "test-3a",
        defaultOptions,
        defaultCallbacks,
      );
      const instance2 = terminalManager.getOrCreate(
        "test-3b",
        defaultOptions,
        defaultCallbacks,
      );

      expect(instance1).not.toBe(instance2);
    });
  });

  describe("destroy", () => {
    it("should dispose terminal", () => {
      const instance = terminalManager.getOrCreate(
        "test-dispose",
        defaultOptions,
        defaultCallbacks,
      );
      terminalManager.destroy("test-dispose");

      expect(instance.terminal.dispose).toHaveBeenCalled();
    });

    it("should do nothing for non-existent id", () => {
      expect(() => terminalManager.destroy("non-existent-3")).not.toThrow();
    });
  });

  describe("resize", () => {
    it("should call terminal.resize", () => {
      const instance = terminalManager.getOrCreate(
        "test-resize",
        defaultOptions,
        defaultCallbacks,
      );
      terminalManager.resize("test-resize", 100, 30);

      expect(instance.terminal.resize).toHaveBeenCalledWith(100, 30);
    });

    it("should do nothing for non-existent id", () => {
      expect(() =>
        terminalManager.resize("non-existent-4", 100, 30),
      ).not.toThrow();
    });
  });

  describe("fit", () => {
    it("should call fitAddon.fit and return dimensions on first call", () => {
      const instance = terminalManager.getOrCreate(
        "test-fit",
        defaultOptions,
        defaultCallbacks,
      );
      const result = terminalManager.fit("test-fit");

      expect(instance.fitAddon.fit).toHaveBeenCalled();
      expect(result).toEqual({ cols: 80, rows: 24 });
    });

    it("should return null on subsequent calls with same size", () => {
      terminalManager.getOrCreate(
        "test-fit-cache",
        defaultOptions,
        defaultCallbacks,
      );
      // 最初の呼び出しはサイズを返す
      const result1 = terminalManager.fit("test-fit-cache");
      expect(result1).toEqual({ cols: 80, rows: 24 });

      // 同じサイズの場合はnullを返す（IPC節約）
      const result2 = terminalManager.fit("test-fit-cache");
      expect(result2).toBeNull();
    });

    it("should return null for non-existent id", () => {
      const result = terminalManager.fit("non-existent-5");
      expect(result).toBeNull();
    });
  });

  describe("focus", () => {
    it("should call terminal.focus", () => {
      const instance = terminalManager.getOrCreate(
        "test-focus",
        defaultOptions,
        defaultCallbacks,
      );
      terminalManager.focus("test-focus");

      expect(instance.terminal.focus).toHaveBeenCalled();
    });
  });

  describe("scrollToBottom", () => {
    it("should call terminal.scrollToBottom", () => {
      const instance = terminalManager.getOrCreate(
        "test-scroll",
        defaultOptions,
        defaultCallbacks,
      );
      terminalManager.scrollToBottom("test-scroll");

      expect(instance.terminal.scrollToBottom).toHaveBeenCalled();
    });

    it("should do nothing for non-existent id", () => {
      expect(() =>
        terminalManager.scrollToBottom("non-existent-scroll"),
      ).not.toThrow();
    });
  });

  // Bug 3 回帰テスト: スクロールアウトしたプロンプトドットが左端に貼り付く現象の防止
  describe("OSC 7770 decoration onRender", () => {
    it("should skip styling when xterm has hidden the element (display:none)", () => {
      // decoration の onRender コールバックを捕捉する
      let capturedOnRender: ((el: HTMLElement) => void) | null = null;
      const decorationMock = {
        onRender: vi.fn((cb: (el: HTMLElement) => void) => {
          capturedOnRender = cb;
        }),
        dispose: vi.fn(),
      };

      const instance = terminalManager.getOrCreate(
        "test-osc-deco",
        defaultOptions,
        defaultCallbacks,
      );

      // registerDecoration をこのテスト専用に差し替え
      (
        instance.terminal as unknown as {
          registerDecoration: (opts: unknown) => unknown;
        }
      ).registerDecoration = vi.fn().mockReturnValue(decorationMock);

      // getOrCreate 内で registerOscHandler(7770, handler) が既に呼ばれている。
      // vi.fn() の calls から直接 OSC 7770 ハンドラを取得する
      const registerOscHandlerMock = instance.terminal.parser
        .registerOscHandler as unknown as ReturnType<typeof vi.fn>;
      const osc7770Call = registerOscHandlerMock.mock.calls.find(
        (call) => call[0] === 7770,
      );
      expect(osc7770Call).toBeDefined();
      const oscHandler = osc7770Call![1] as (data: string) => boolean;

      // OSC "A" → マーカー作成、OSC "D;0" → 緑ドットデコレーション作成
      oscHandler("A");
      oscHandler("D;0");

      // onRender コールバックが登録済み
      expect(capturedOnRender).not.toBeNull();

      // 画面内ケース: display:"block" → flex に上書きされる
      const visibleEl = document.createElement("div");
      visibleEl.style.display = "block";
      capturedOnRender!(visibleEl);
      expect(visibleEl.style.display).toBe("flex");
      expect(visibleEl.textContent).toBe("●");

      // 画面外ケース: display:"none" → 早期 return、display は "none" のまま
      const hiddenEl = document.createElement("div");
      hiddenEl.style.display = "none";
      capturedOnRender!(hiddenEl);
      expect(hiddenEl.style.display).toBe("none");
      expect(hiddenEl.textContent).toBe(""); // スタイル適用されず textContent も未設定
    });
  });

  describe("selection", () => {
    it("should select current line", () => {
      const instance = terminalManager.getOrCreate(
        "test-select-line",
        defaultOptions,
        defaultCallbacks,
      );
      terminalManager.selectCurrentLine("test-select-line");

      expect(instance.terminal.selectLines).toHaveBeenCalledWith(0, 0);
    });
  });

  describe("undo / redo", () => {
    // terminal.onData(fn) に渡したコールバックを取り出して、ユーザーのキー入力をシミュレートする
    const getOnDataCallback = (
      instance: ReturnType<typeof terminalManager.getOrCreate>,
    ): ((data: string) => void) => {
      const mock = instance.terminal.onData as unknown as {
        mock: { calls: Array<[(data: string) => void]> };
      };
      const callback = mock.mock.calls[0]?.[0];
      if (!callback) throw new Error("onData callback not registered");
      return callback;
    };

    const setAltScreen = (
      instance: ReturnType<typeof terminalManager.getOrCreate>,
      alt: boolean,
    ): void => {
      (instance.terminal.buffer.active as { type: string }).type = alt
        ? "alternate"
        : "normal";
    };

    it("records normal typing and restores via undo/redo", () => {
      const id = "test-undo-typing";
      const instance = terminalManager.getOrCreate(
        id,
        defaultOptions,
        defaultCallbacks,
      );
      const onData = getOnDataCallback(instance);

      onData("h");
      onData("e");
      onData("l");

      expect(instance.inputHistory.currentLine).toBe("hel");
      expect(instance.inputHistory.undoStack).toEqual(["", "h", "he"]);

      expect(terminalManager.undo(id)).toBe(true);
      expect(instance.inputHistory.currentLine).toBe("he");
      expect(instance.inputHistory.redoStack).toEqual(["hel"]);

      expect(terminalManager.redo(id)).toBe(true);
      expect(instance.inputHistory.currentLine).toBe("hel");
      expect(instance.inputHistory.redoStack).toEqual([]);
    });

    it("returns false when undo/redo stacks are empty", () => {
      const id = "test-undo-empty";
      terminalManager.getOrCreate(id, defaultOptions, defaultCallbacks);

      expect(terminalManager.undo(id)).toBe(false);
      expect(terminalManager.redo(id)).toBe(false);
    });

    it("treats Backspace as a history step", () => {
      const id = "test-undo-backspace";
      const instance = terminalManager.getOrCreate(
        id,
        defaultOptions,
        defaultCallbacks,
      );
      const onData = getOnDataCallback(instance);

      onData("a");
      onData("b");
      onData("\x7f"); // Backspace

      expect(instance.inputHistory.currentLine).toBe("a");
      expect(terminalManager.undo(id)).toBe(true);
      expect(instance.inputHistory.currentLine).toBe("ab");
    });

    it("treats Ctrl+U (\\x15) as clear-line and undo restores full line", () => {
      const id = "test-undo-ctrlu";
      const instance = terminalManager.getOrCreate(
        id,
        defaultOptions,
        defaultCallbacks,
      );
      const onData = getOnDataCallback(instance);

      onData("h");
      onData("e");
      onData("l");
      onData("l");
      onData("o");
      expect(instance.inputHistory.currentLine).toBe("hello");

      // Cmd+Backspace 相当の history-aware write
      terminalManager.writeWithHistory(id, "\x15");
      expect(instance.inputHistory.currentLine).toBe("");

      expect(terminalManager.undo(id)).toBe(true);
      expect(instance.inputHistory.currentLine).toBe("hello");
    });

    it("clears history on Enter", () => {
      const id = "test-undo-enter";
      const instance = terminalManager.getOrCreate(
        id,
        defaultOptions,
        defaultCallbacks,
      );
      const onData = getOnDataCallback(instance);

      onData("a");
      onData("b");
      onData("\r");

      expect(instance.inputHistory.undoStack).toEqual([]);
      expect(instance.inputHistory.redoStack).toEqual([]);
      expect(instance.inputHistory.currentLine).toBe("");
      expect(terminalManager.undo(id)).toBe(false);
    });

    it("caps the undo stack at MAX_UNDO_STACK_SIZE", () => {
      const id = "test-undo-cap";
      const instance = terminalManager.getOrCreate(
        id,
        defaultOptions,
        defaultCallbacks,
      );
      const onData = getOnDataCallback(instance);

      for (let i = 0; i < 150; i++) onData("x");

      expect(instance.inputHistory.undoStack.length).toBe(100);
      // 最古のエントリは破棄されている
      expect(instance.inputHistory.undoStack[0]).not.toBe("");
    });

    it("clears redoStack when new input arrives after undo", () => {
      const id = "test-undo-redo-invalidate";
      const instance = terminalManager.getOrCreate(
        id,
        defaultOptions,
        defaultCallbacks,
      );
      const onData = getOnDataCallback(instance);

      onData("a");
      onData("b");
      terminalManager.undo(id);
      expect(instance.inputHistory.redoStack.length).toBe(1);

      onData("c");
      expect(instance.inputHistory.redoStack).toEqual([]);
    });

    it("is a no-op on alternate screen (TUI)", () => {
      const id = "test-undo-altscreen";
      const instance = terminalManager.getOrCreate(
        id,
        defaultOptions,
        defaultCallbacks,
      );
      const onData = getOnDataCallback(instance);

      onData("a");
      onData("b");
      setAltScreen(instance, true);

      // ALT screen 中は onData の履歴記録が止まる
      onData("c");
      expect(instance.inputHistory.currentLine).toBe("ab");

      // undo も発火しない
      expect(terminalManager.undo(id)).toBe(false);

      // 戻れば再び動く
      setAltScreen(instance, false);
      expect(terminalManager.undo(id)).toBe(true);
    });

    it("sends Ctrl+E + Ctrl+U + previous line via pty.write on undo", () => {
      const id = "test-undo-pty-write";
      const instance = terminalManager.getOrCreate(
        id,
        defaultOptions,
        defaultCallbacks,
      );
      const onData = getOnDataCallback(instance);

      onData("h");
      onData("i");
      mockPtyApi.write.mockClear();

      terminalManager.undo(id);

      expect(mockPtyApi.write).toHaveBeenNthCalledWith(1, id, "\x05\x15");
      expect(mockPtyApi.write).toHaveBeenNthCalledWith(2, id, "h");
    });

    it("writeWithHistory records control sequences sent by shortcuts", () => {
      const id = "test-write-with-history";
      const instance = terminalManager.getOrCreate(
        id,
        defaultOptions,
        defaultCallbacks,
      );
      const onData = getOnDataCallback(instance);

      onData("f");
      onData("o");
      onData("o");

      terminalManager.writeWithHistory(id, "\x17"); // Ctrl+W: delete word backward
      expect(instance.inputHistory.currentLine).toBe("");
      expect(mockPtyApi.write).toHaveBeenLastCalledWith(id, "\x17");
    });
  });
});
