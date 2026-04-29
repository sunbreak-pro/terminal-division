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
    clear = vi.fn();
    clearTextureAtlas = vi.fn();
    reset = vi.fn();
    options: {
      theme: object;
      fontFamily: string;
      fontSize: number;
      scrollback?: number;
    } = {
      theme: {},
      fontFamily: "monospace",
      fontSize: 13,
      scrollback: 10000,
    };
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

// 永続的な metas Map を共有して setShellName/setProcessName が反映されるようにする
const __testMetas = new Map<
  string,
  {
    cwd: string | null;
    processName: string | null;
    shellName: string | null;
    lastActiveAt: number;
    createdAt: number;
  }
>();
vi.mock("../../stores/terminalMetaStore", () => ({
  useTerminalMetaStore: {
    getState: () => ({
      metas: __testMetas,
      initMeta: (id: string) => {
        if (__testMetas.has(id)) return;
        __testMetas.set(id, {
          cwd: null,
          processName: null,
          shellName: null,
          lastActiveAt: 0,
          createdAt: 0,
        });
      },
      setCwd: (id: string, cwd: string) => {
        const m = __testMetas.get(id);
        if (m) m.cwd = cwd;
      },
      setProcessName: (id: string, processName: string) => {
        const m = __testMetas.get(id);
        if (m) m.processName = processName;
      },
      setShellName: (id: string, shellName: string) => {
        const m = __testMetas.get(id);
        if (m) m.shellName = shellName;
      },
      removeMeta: (id: string) => {
        __testMetas.delete(id);
      },
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
import { useTerminalMetaStore } from "../../stores/terminalMetaStore";

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
    __testMetas.clear();
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

    // StrictMode 二重マウント耐性: 同一 id で getOrCreate が複数回呼ばれても
    // listener / OSC ハンドラ / IPC subscriber は 1 度しか登録されない
    it("does not duplicate listeners when called twice with the same id", () => {
      const id = "test-idempotent";
      mockPtyApi.onData.mockClear();
      mockPtyApi.onExit.mockClear();
      mockPtyApi.onProcessName.mockClear();
      mockPtyApi.onShellName.mockClear();

      const instance1 = terminalManager.getOrCreate(
        id,
        defaultOptions,
        defaultCallbacks,
      );
      const onDataCallsAfterFirst = (
        instance1.terminal.onData as unknown as { mock: { calls: unknown[] } }
      ).mock.calls.length;
      const oscCallsAfterFirst = (
        instance1.terminal.parser.registerOscHandler as unknown as {
          mock: { calls: unknown[] };
        }
      ).mock.calls.length;

      const instance2 = terminalManager.getOrCreate(
        id,
        defaultOptions,
        defaultCallbacks,
      );

      expect(instance1).toBe(instance2);
      // terminal.onData / OSC ハンドラの登録回数は最初の作成時から増えていない
      expect(
        (instance2.terminal.onData as unknown as { mock: { calls: unknown[] } })
          .mock.calls.length,
      ).toBe(onDataCallsAfterFirst);
      expect(
        (
          instance2.terminal.parser.registerOscHandler as unknown as {
            mock: { calls: unknown[] };
          }
        ).mock.calls.length,
      ).toBe(oscCallsAfterFirst);
      // IPC リスナーも 1 度ずつしか登録されない
      expect(mockPtyApi.onData).toHaveBeenCalledTimes(1);
      expect(mockPtyApi.onExit).toHaveBeenCalledTimes(1);
      expect(mockPtyApi.onProcessName).toHaveBeenCalledTimes(1);
      expect(mockPtyApi.onShellName).toHaveBeenCalledTimes(1);
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

    it("invalidateLastSize forces fit() to return size again on same dimensions", () => {
      terminalManager.getOrCreate(
        "test-fit-invalidate",
        defaultOptions,
        defaultCallbacks,
      );
      const first = terminalManager.fit("test-fit-invalidate");
      expect(first).toEqual({ cols: 80, rows: 24 });
      // キャッシュにより 2 回目は null
      expect(terminalManager.fit("test-fit-invalidate")).toBeNull();
      // invalidate するとサイズ変化なしでも再度値を返す
      terminalManager.invalidateLastSize("test-fit-invalidate");
      const after = terminalManager.fit("test-fit-invalidate");
      expect(after).toEqual({ cols: 80, rows: 24 });
    });

    it("invalidateLastSize is a no-op for unknown id", () => {
      // 例外を投げずに静かに完了
      expect(() =>
        terminalManager.invalidateLastSize("never-created"),
      ).not.toThrow();
    });

    it("returns null and schedules rAF retry when fitAddon throws once", () => {
      const instance = terminalManager.getOrCreate(
        "test-fit-retry",
        defaultOptions,
        defaultCallbacks,
      );
      const fitMock = instance.fitAddon.fit as unknown as ReturnType<
        typeof vi.fn
      >;
      // 1 回目だけ例外を投げ、2 回目以降は通常成功する mock 動作
      fitMock.mockImplementationOnce(() => {
        throw new Error("offsetWidth=0");
      });

      // rAF を同期実行する mock を仕込む
      const rafSpy = vi
        .spyOn(globalThis, "requestAnimationFrame")
        .mockImplementation((cb: FrameRequestCallback) => {
          cb(0);
          return 0 as unknown as number;
        });

      mockPtyApi.resize.mockClear();
      const result = terminalManager.fit("test-fit-retry");
      // 1 回目は例外で null
      expect(result).toBeNull();
      // rAF リトライで pty.resize が直接呼ばれている
      expect(mockPtyApi.resize).toHaveBeenCalledWith("test-fit-retry", 80, 24);
      rafSpy.mockRestore();
    });

    it("returns null when terminal cols is 0 (DOM not ready)", () => {
      const instance = terminalManager.getOrCreate(
        "test-fit-zero",
        defaultOptions,
        defaultCallbacks,
      );
      // fit() は何もせず、cols は MockTerminal のフィールドで上書き
      (instance.terminal as unknown as { cols: number; rows: number }).cols = 0;
      const result = terminalManager.fit("test-fit-zero");
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

    // 回帰テスト: precmd → D;N で色付け → zle-line-init → A の流れで、
    // A ハンドラが直前 decoration を dispose してしまうと、ユーザは成功/失敗色を
    // 視認できないままグレー● に戻ってしまう。A は新マーカーへの差し替えのみ行い、
    // 過去 decoration は破棄しないこと（dispose 呼び出し回数 0）を保証する。
    it("preserves previous decoration when a new prompt (A) starts", () => {
      const decorationMock = {
        onRender: vi.fn(),
        dispose: vi.fn(),
      };

      const instance = terminalManager.getOrCreate(
        "test-osc-preserve-deco",
        defaultOptions,
        defaultCallbacks,
      );

      (
        instance.terminal as unknown as {
          registerDecoration: (opts: unknown) => unknown;
        }
      ).registerDecoration = vi.fn().mockReturnValue(decorationMock);

      const registerOscHandlerMock = instance.terminal.parser
        .registerOscHandler as unknown as ReturnType<typeof vi.fn>;
      const osc7770Call = registerOscHandlerMock.mock.calls.find(
        (call) => call[0] === 7770,
      );
      const oscHandler = osc7770Call![1] as (data: string) => boolean;

      // 1 回目のプロンプト → コマンド完了で色付け
      oscHandler("A");
      oscHandler("D;0");
      expect(instance.promptDot.decoration).toBe(decorationMock);
      expect(decorationMock.dispose).not.toHaveBeenCalled();

      // 2 回目のプロンプト開始: 過去 decoration を dispose しないこと
      oscHandler("A");
      expect(decorationMock.dispose).not.toHaveBeenCalled();
      // promptDot は新しいマーカーに差し替わり、decoration 参照は捨てられている
      expect(instance.promptDot.decoration).toBeNull();
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

  describe("clearScrollback", () => {
    it("should call terminal.clear() and clearTextureAtlas() on the registered instance", () => {
      const instance = terminalManager.getOrCreate(
        "test-clear",
        defaultOptions,
        defaultCallbacks,
      );

      terminalManager.clearScrollback("test-clear");

      expect(instance.terminal.clear).toHaveBeenCalledTimes(1);
      expect(instance.terminal.clearTextureAtlas).toHaveBeenCalledTimes(1);
    });

    it("should be a no-op for unknown id (safe even if pane already destroyed)", () => {
      // 未登録 id では何も投げない・触らない
      expect(() => {
        terminalManager.clearScrollback("non-existent-pane");
      }).not.toThrow();
    });
  });

  describe("trimScrollback", () => {
    it("temporarily lowers scrollback then restores it via microtask", async () => {
      const instance = terminalManager.getOrCreate(
        "test-trim",
        defaultOptions,
        defaultCallbacks,
      );
      // 既定 10000 を下回る値で trim を発火
      terminalManager.trimScrollback("test-trim", 100);
      // 同期: scrollback が 100 に下がっている
      expect(instance.terminal.options.scrollback).toBe(100);
      expect(instance.terminal.clearTextureAtlas).toHaveBeenCalledTimes(1);
      // microtask 解決後に元の値へ戻る
      await Promise.resolve();
      expect(instance.terminal.options.scrollback).toBe(10000);
    });

    it("is a no-op when keepLines >= current scrollback", async () => {
      const instance = terminalManager.getOrCreate(
        "test-trim-noop-large",
        defaultOptions,
        defaultCallbacks,
      );
      terminalManager.trimScrollback("test-trim-noop-large", 10000);
      expect(instance.terminal.options.scrollback).toBe(10000);
      expect(instance.terminal.clearTextureAtlas).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(instance.terminal.options.scrollback).toBe(10000);
    });

    it("is a no-op for negative or non-finite keepLines", () => {
      const instance = terminalManager.getOrCreate(
        "test-trim-noop-neg",
        defaultOptions,
        defaultCallbacks,
      );
      terminalManager.trimScrollback("test-trim-noop-neg", -1);
      terminalManager.trimScrollback("test-trim-noop-neg", Number.NaN);
      terminalManager.trimScrollback(
        "test-trim-noop-neg",
        Number.POSITIVE_INFINITY,
      );
      expect(instance.terminal.options.scrollback).toBe(10000);
      expect(instance.terminal.clearTextureAtlas).not.toHaveBeenCalled();
    });

    it("is a no-op for unknown id", () => {
      expect(() => {
        terminalManager.trimScrollback("non-existent-pane", 100);
      }).not.toThrow();
    });
  });

  describe("applyOptions", () => {
    it("writes through non-size-affecting keys without re-fitting", () => {
      const instance = terminalManager.getOrCreate(
        "apply-1",
        defaultOptions,
        defaultCallbacks,
      );
      const fitSpy = vi.spyOn(instance.fitAddon, "fit");
      fitSpy.mockClear();

      const result = terminalManager.applyOptions("apply-1", {
        cursorStyle: "underline",
        cursorBlink: false,
        scrollback: 5000,
      });

      expect(result).toBeNull(); // 非セルサイズキーは fit を起動しない
      expect(fitSpy).not.toHaveBeenCalled();
      // option は xterm 側へ反映されている（Mock の options に直接書かれる）
      const opts = instance.terminal.options as unknown as Record<
        string,
        unknown
      >;
      expect(opts.cursorStyle).toBe("underline");
      expect(opts.cursorBlink).toBe(false);
      expect(opts.scrollback).toBe(5000);
    });

    it("re-fits when size-affecting keys (fontSize / fontFamily / lineHeight) change", () => {
      const instance = terminalManager.getOrCreate(
        "apply-2",
        defaultOptions,
        defaultCallbacks,
      );
      const fitSpy = vi.spyOn(instance.fitAddon, "fit");
      // モックの fitAddon.fit は通常 cols/rows を変えないので applyOptions の戻り値は
      // null になる可能性があるが、fit() の呼び出し自体は確認できる。
      fitSpy.mockClear();

      terminalManager.applyOptions("apply-2", { fontSize: 18 });
      expect(fitSpy).toHaveBeenCalled();

      const opts = instance.terminal.options as unknown as Record<
        string,
        unknown
      >;
      expect(opts.fontSize).toBe(18);
    });

    it("ignores undefined values in the patch", () => {
      const instance = terminalManager.getOrCreate(
        "apply-3",
        defaultOptions,
        defaultCallbacks,
      );
      const opts = instance.terminal.options as unknown as Record<
        string,
        unknown
      >;
      const before = opts.fontSize;
      terminalManager.applyOptions("apply-3", { fontSize: undefined });
      expect(opts.fontSize).toBe(before);
    });

    it("returns null for unknown id (safe no-op)", () => {
      expect(
        terminalManager.applyOptions("ghost", { fontSize: 18 }),
      ).toBeNull();
    });
  });

  describe("resetTerminal", () => {
    it("calls terminal.reset() and clearTextureAtlas() on the registered instance", () => {
      const instance = terminalManager.getOrCreate(
        "test-reset",
        defaultOptions,
        defaultCallbacks,
      );
      terminalManager.resetTerminal("test-reset");
      expect(instance.terminal.reset).toHaveBeenCalledTimes(1);
      expect(instance.terminal.clearTextureAtlas).toHaveBeenCalledTimes(1);
    });

    it("is a no-op for unknown id", () => {
      expect(() => {
        terminalManager.resetTerminal("non-existent-pane");
      }).not.toThrow();
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

    // undo/redo/writeWithHistory はシェル起動完了後（OSC 7770;A 受信後）に動く設計のため、
    // テスト用に shellReady を立てたインスタンスを返すヘルパーを使う。
    // また Undo/Redo は前面プロセスがシェルのときのみ動くため、processName=shellName を
    // セットしておく（実環境の "プロンプト待ち" 状態を模す）。
    const createReadyInstance = (
      id: string,
    ): ReturnType<typeof terminalManager.getOrCreate> => {
      const instance = terminalManager.getOrCreate(
        id,
        defaultOptions,
        defaultCallbacks,
      );
      instance.shellReady = true;
      const meta = useTerminalMetaStore.getState();
      meta.setShellName(id, "zsh");
      meta.setProcessName(id, "zsh");
      return instance;
    };

    it("records normal typing and restores via undo/redo", () => {
      const id = "test-undo-typing";
      const instance = createReadyInstance(id);
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
      const instance = createReadyInstance(id);
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
      const instance = createReadyInstance(id);
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
      const instance = createReadyInstance(id);
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
      const instance = createReadyInstance(id);
      const onData = getOnDataCallback(instance);

      for (let i = 0; i < 150; i++) onData("x");

      expect(instance.inputHistory.undoStack.length).toBe(100);
      // 最古のエントリは破棄されている
      expect(instance.inputHistory.undoStack[0]).not.toBe("");
    });

    it("clears redoStack when new input arrives after undo", () => {
      const id = "test-undo-redo-invalidate";
      const instance = createReadyInstance(id);
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
      const instance = createReadyInstance(id);
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
      const instance = createReadyInstance(id);
      const onData = getOnDataCallback(instance);

      onData("h");
      onData("i");
      mockPtyApi.write.mockClear();

      terminalManager.undo(id);

      expect(mockPtyApi.write).toHaveBeenNthCalledWith(1, id, "\x05\x15");
      expect(mockPtyApi.write).toHaveBeenNthCalledWith(2, id, "h");
    });

    it("returns false when foreground process is not the shell (e.g. claude/vim)", () => {
      const id = "test-undo-foreign-fg";
      const instance = createReadyInstance(id);
      const onData = getOnDataCallback(instance);

      onData("a");
      onData("b");
      expect(terminalManager.undo(id)).toBe(true);
      expect(terminalManager.redo(id)).toBe(true);

      // 前面プロセスが claude / node / vim 等のシェル以外に切り替わったとき
      useTerminalMetaStore.getState().setProcessName(id, "claude");
      expect(terminalManager.undo(id)).toBe(false);
      expect(terminalManager.redo(id)).toBe(false);

      // シェルに戻れば再び動く
      useTerminalMetaStore.getState().setProcessName(id, "zsh");
      expect(terminalManager.undo(id)).toBe(true);
    });

    it("writeWithHistory records control sequences sent by shortcuts", () => {
      const id = "test-write-with-history";
      const instance = createReadyInstance(id);
      const onData = getOnDataCallback(instance);

      onData("f");
      onData("o");
      onData("o");

      terminalManager.writeWithHistory(id, "\x17"); // Ctrl+W: delete word backward
      expect(instance.inputHistory.currentLine).toBe("");
      expect(mockPtyApi.write).toHaveBeenLastCalledWith(id, "\x17");
    });
  });

  describe("shell readiness gating", () => {
    it("isShellReady is false right after getOrCreate", () => {
      const id = "test-ready-false";
      terminalManager.getOrCreate(id, defaultOptions, defaultCallbacks);
      expect(terminalManager.isShellReady(id)).toBe(false);
    });

    it("isShellReady stays false without OSC 7770;A (no fallback timer)", () => {
      const id = "test-ready-no-fallback";
      terminalManager.getOrCreate(id, defaultOptions, defaultCallbacks);
      expect(terminalManager.isShellReady(id)).toBe(false);
      vi.advanceTimersByTime(60_000);
      expect(terminalManager.isShellReady(id)).toBe(false);
    });

    it("isShellReady becomes true when the OSC 7770;A handler fires", () => {
      const id = "test-ready-osc";
      const instance = terminalManager.getOrCreate(
        id,
        defaultOptions,
        defaultCallbacks,
      );
      expect(terminalManager.isShellReady(id)).toBe(false);

      // getOrCreate 内で terminal.parser.registerOscHandler(7770, handler) が呼ばれている
      const oscCalls = (
        instance.terminal.parser.registerOscHandler as unknown as ReturnType<
          typeof vi.fn
        >
      ).mock.calls;
      const oscEntry = oscCalls.find(([code]: [number]) => code === 7770) as
        | [number, (data: string) => boolean]
        | undefined;
      expect(oscEntry).toBeDefined();
      const handler = oscEntry![1];

      // "A" コマンド = プロンプト開始マーカー → shellReady を true にする
      handler("A");
      expect(terminalManager.isShellReady(id)).toBe(true);
    });

    it("writeWithHistory is suppressed when shell is not ready", () => {
      const id = "test-ready-suppress-write";
      terminalManager.getOrCreate(id, defaultOptions, defaultCallbacks);
      mockPtyApi.write.mockClear();

      terminalManager.writeWithHistory(id, "\x01"); // Ctrl+A
      expect(mockPtyApi.write).not.toHaveBeenCalled();
    });

    it("undo / redo return false when shell is not ready", () => {
      const id = "test-ready-suppress-undo";
      const instance = terminalManager.getOrCreate(
        id,
        defaultOptions,
        defaultCallbacks,
      );
      // 履歴を直接積んでも shellReady=false の間は undo/redo は false を返す
      instance.inputHistory.undoStack.push("a");
      expect(terminalManager.undo(id)).toBe(false);
      instance.inputHistory.redoStack.push("a");
      expect(terminalManager.redo(id)).toBe(false);
    });

    it("isShellReady returns false for non-existent id", () => {
      expect(terminalManager.isShellReady("does-not-exist")).toBe(false);
    });
  });
});
