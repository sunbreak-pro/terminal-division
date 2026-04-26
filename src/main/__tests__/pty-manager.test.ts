import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// モック関数をvi.hoisted()で定義してホイスト問題を回避
const {
  mockOnData,
  mockOnExit,
  mockWrite,
  mockResize,
  mockKill,
  mockSpawn,
  mockSend,
  mockIsDestroyed,
  mockProcess,
} = vi.hoisted(() => ({
  mockOnData: vi.fn(),
  mockOnExit: vi.fn(),
  mockWrite: vi.fn(),
  mockResize: vi.fn(),
  mockKill: vi.fn(),
  mockSpawn: vi.fn(),
  mockSend: vi.fn(),
  mockIsDestroyed: vi.fn().mockReturnValue(false),
  mockProcess: "zsh",
}));

// node-ptyモック
vi.mock("node-pty", () => ({
  spawn: mockSpawn.mockReturnValue({
    onData: mockOnData,
    onExit: mockOnExit,
    write: mockWrite,
    resize: mockResize,
    kill: mockKill,
    process: mockProcess,
  }),
}));

// Electronモック
vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
}));

// osモック
vi.mock("os", () => ({
  homedir: vi.fn().mockReturnValue("/Users/test"),
}));

// shell-integrationモック
vi.mock("../shell-integration", () => ({
  getShellIntegrationEnv: vi.fn().mockReturnValue({}),
  getShellArgs: vi.fn().mockReturnValue([]),
  getMergedPath: vi.fn().mockReturnValue("/usr/bin:/usr/local/bin"),
  cleanup: vi.fn(),
}));

// fsモック
vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

import { ptyManager } from "../pty-manager";
import { cleanup as cleanupShellIntegration } from "../shell-integration";

// モックウィンドウの作成ヘルパー
function createMockWindow(isDestroyed = false): {
  webContents: { send: typeof mockSend };
  isDestroyed: () => boolean;
} {
  return {
    webContents: { send: mockSend },
    isDestroyed: mockIsDestroyed.mockReturnValue(isDestroyed),
  };
}

// 2つ目のウィンドウ用の別モック
const mockSend2 = vi.fn();
const mockIsDestroyed2 = vi.fn().mockReturnValue(false);

function createMockWindow2(): {
  webContents: { send: typeof mockSend2 };
  isDestroyed: () => boolean;
} {
  return {
    webContents: { send: mockSend2 },
    isDestroyed: mockIsDestroyed2,
  };
}

describe("PtyManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const mockWindow = createMockWindow();
    ptyManager.registerWindow(
      1,
      mockWindow as unknown as Electron.BrowserWindow,
    );
  });

  afterEach(() => {
    ptyManager.killAll();
    vi.useRealTimers();
  });

  describe("registerWindow / unregisterWindow", () => {
    it("should allow PTY creation and data sending after registration", () => {
      const result = ptyManager.createPty("reg-test", 1);
      expect(result).toBe(true);

      // 初期出力は buffering されるため、flush で通常モードへ切り替える
      ptyManager.flushInitialBuffer("reg-test");

      // onDataコールバック経由でデータ送信を確認
      const onDataCallback = mockOnData.mock.calls[0][0];
      onDataCallback("test output");

      expect(mockSend).toHaveBeenCalledWith("pty:data", {
        id: "reg-test",
        data: "test output",
      });
    });

    it("should not send to renderer after unregisterWindow", () => {
      ptyManager.createPty("unreg-test", 1);
      ptyManager.flushInitialBuffer("unreg-test");
      ptyManager.unregisterWindow(1);

      mockSend.mockClear();
      const onDataCallback =
        mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0];
      onDataCallback("test");

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("createPty", () => {
    it("should create a PTY with the specified windowId", () => {
      const result = ptyManager.createPty("test-1", 1);

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          encoding: "utf8",
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd: "/Users/test",
        }),
      );
    });

    it("should return false for duplicate id", () => {
      ptyManager.createPty("dup-test", 1);
      const result = ptyManager.createPty("dup-test", 1);

      expect(result).toBe(false);
    });

    it("should send data to the correct windowId via onData", () => {
      ptyManager.createPty("data-test", 1);
      ptyManager.flushInitialBuffer("data-test");

      const onDataCallback = mockOnData.mock.calls[0][0];
      onDataCallback("test output");

      expect(mockSend).toHaveBeenCalledWith("pty:data", {
        id: "data-test",
        data: "test output",
      });
    });

    it("should send exit to the correct windowId via onExit", () => {
      ptyManager.createPty("exit-test", 1);

      const onExitCallback = mockOnExit.mock.calls[0][0];
      onExitCallback({ exitCode: 0 });

      expect(mockSend).toHaveBeenCalledWith("pty:exit", {
        id: "exit-test",
        exitCode: 0,
      });
    });

    it("should filter npm_ environment variables", () => {
      process.env.npm_test_var = "should-be-filtered";
      process.env.NORMAL_VAR = "should-exist";

      ptyManager.createPty("filter-test", 1);

      const spawnCall = mockSpawn.mock.calls[0];
      const envArg = spawnCall[2].env;

      expect(envArg.npm_test_var).toBeUndefined();
      expect(envArg.LANG).toBe("ja_JP.UTF-8");

      delete process.env.npm_test_var;
      delete process.env.NORMAL_VAR;
    });

    it("should use initialCwd when specified", () => {
      ptyManager.createPty("cwd-test", 1, "/custom/path");

      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[2].cwd).toBe("/custom/path");
    });

    it("should send shellName to renderer", () => {
      ptyManager.createPty("shell-test", 1);

      expect(mockSend).toHaveBeenCalledWith("pty:shellName", {
        id: "shell-test",
        shellName: expect.any(String),
      });
    });

    it("should set up processName polling interval", () => {
      ptyManager.createPty("poll-test", 1);

      // setIntervalが設定されていることをタイマーの存在で確認
      // killするとclearIntervalが呼ばれるので、kill前後の挙動で検証
      ptyManager.kill("poll-test");
      // kill後に再作成できる = 正常にクリーンアップされた
      const result = ptyManager.createPty("poll-test", 1);
      expect(result).toBe(true);
    });
  });

  describe("write", () => {
    it("should write small data directly", () => {
      ptyManager.createPty("write-small", 1);
      ptyManager.write("write-small", "hello");

      expect(mockWrite).toHaveBeenCalledWith("hello");
    });

    it("should do nothing for non-existent id", () => {
      mockWrite.mockClear();
      ptyManager.write("non-existent", "data");

      expect(mockWrite).not.toHaveBeenCalled();
    });

    it("should use chunked write with bracket paste for large data", () => {
      ptyManager.createPty("write-large", 1);

      const largeData = "x".repeat(600);
      ptyManager.write("write-large", largeData);

      // ブラケットペースト開始が書き込まれる
      expect(mockWrite).toHaveBeenCalledWith("\x1b[200~");
    });
  });

  describe("resize", () => {
    it("should resize PTY", () => {
      ptyManager.createPty("resize-test", 1);
      ptyManager.resize("resize-test", 120, 40);

      expect(mockResize).toHaveBeenCalledWith(120, 40);
    });

    it("should do nothing for non-existent id", () => {
      mockResize.mockClear();
      ptyManager.resize("non-existent", 100, 30);

      expect(mockResize).not.toHaveBeenCalled();
    });
  });

  describe("kill", () => {
    it("should kill PTY process", () => {
      ptyManager.createPty("kill-test", 1);
      ptyManager.kill("kill-test");

      expect(mockKill).toHaveBeenCalled();
    });

    it("should remove PTY from processes map", () => {
      ptyManager.createPty("kill-reuse", 1);
      ptyManager.kill("kill-reuse");

      // 同じIDで再作成できるはず
      const result = ptyManager.createPty("kill-reuse", 1);
      expect(result).toBe(true);
    });

    it("should clear processNameInterval", () => {
      ptyManager.createPty("kill-interval", 1);
      // kill前のclearIntervalが呼ばれることを間接的に検証
      ptyManager.kill("kill-interval");

      // 再作成可能 = クリーンアップ成功
      expect(ptyManager.createPty("kill-interval", 1)).toBe(true);
    });

    it("should do nothing for non-existent id", () => {
      mockKill.mockClear();
      ptyManager.kill("non-existent");

      expect(mockKill).not.toHaveBeenCalled();
    });
  });

  describe("killAllForWindow", () => {
    it("should kill only PTYs for the specified window", () => {
      const mockWindow2 = createMockWindow2();
      ptyManager.registerWindow(
        2,
        mockWindow2 as unknown as Electron.BrowserWindow,
      );

      ptyManager.createPty("win1-pty", 1);
      ptyManager.createPty("win2-pty", 2);

      mockKill.mockClear();
      ptyManager.killAllForWindow(1);

      // window 1のPTYだけがkillされる
      expect(mockKill).toHaveBeenCalledTimes(1);

      // window 2のPTYは生き残る（重複IDでの作成がfalseになるはず）
      expect(ptyManager.createPty("win2-pty", 2)).toBe(false);
      // window 1のPTYは再作成できる
      expect(ptyManager.createPty("win1-pty", 1)).toBe(true);

      ptyManager.unregisterWindow(2);
    });
  });

  describe("killAll", () => {
    it("should kill all PTY processes", () => {
      ptyManager.createPty("all-1", 1);
      ptyManager.createPty("all-2", 1);
      ptyManager.createPty("all-3", 1);

      mockKill.mockClear();
      ptyManager.killAll();

      expect(mockKill).toHaveBeenCalledTimes(3);
    });

    it("should call shellIntegration.cleanup", () => {
      ptyManager.killAll();

      expect(cleanupShellIntegration).toHaveBeenCalled();
    });
  });

  describe("sendToRenderer (via onData)", () => {
    it("should not send if window is destroyed", () => {
      ptyManager.createPty("destroyed-test", 1);
      ptyManager.flushInitialBuffer("destroyed-test");

      mockIsDestroyed.mockReturnValue(true);
      mockSend.mockClear();

      const onDataCallback =
        mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0];
      onDataCallback("test");

      expect(mockSend).not.toHaveBeenCalled();
      mockIsDestroyed.mockReturnValue(false);
    });

    it("should not send if window is not registered", () => {
      ptyManager.createPty("unreg-send", 1);
      ptyManager.flushInitialBuffer("unreg-send");
      ptyManager.unregisterWindow(1);

      mockSend.mockClear();

      const onDataCallback =
        mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0];
      onDataCallback("test");

      expect(mockSend).not.toHaveBeenCalled();

      // 再登録してクリーンアップできるように
      const mockWindow = createMockWindow();
      ptyManager.registerWindow(
        1,
        mockWindow as unknown as Electron.BrowserWindow,
      );
    });
  });

  describe("initial buffer / flushInitialBuffer", () => {
    it("should buffer initial output and not send until flushed", () => {
      ptyManager.createPty("buffer-test", 1);

      mockSend.mockClear();
      const onDataCallback =
        mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0];
      onDataCallback("zsh-startup-line-1\n");
      onDataCallback("zsh-startup-line-2\n");

      // buffering 中は pty:data が送られない
      expect(mockSend).not.toHaveBeenCalledWith(
        "pty:data",
        expect.objectContaining({ id: "buffer-test" }),
      );
    });

    it("should flush buffered output when flushInitialBuffer is called", () => {
      ptyManager.createPty("flush-test", 1);

      const onDataCallback =
        mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0];
      onDataCallback("hello ");
      onDataCallback("world");

      mockSend.mockClear();
      ptyManager.flushInitialBuffer("flush-test");

      expect(mockSend).toHaveBeenCalledWith("pty:data", {
        id: "flush-test",
        data: "hello world",
      });
    });

    it("should send subsequent output directly after flush", () => {
      ptyManager.createPty("post-flush", 1);
      ptyManager.flushInitialBuffer("post-flush");

      mockSend.mockClear();
      const onDataCallback =
        mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0];
      onDataCallback("after");

      expect(mockSend).toHaveBeenCalledWith("pty:data", {
        id: "post-flush",
        data: "after",
      });
    });

    it("should be idempotent (second flush is a no-op)", () => {
      ptyManager.createPty("idem-test", 1);

      const onDataCallback =
        mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0];
      onDataCallback("buffered");

      ptyManager.flushInitialBuffer("idem-test");
      mockSend.mockClear();
      ptyManager.flushInitialBuffer("idem-test");

      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should auto-flush when buffer exceeds limit", () => {
      ptyManager.createPty("auto-flush", 1);

      const onDataCallback =
        mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0];
      // 64KB を超える出力
      const largeChunk = "x".repeat(65 * 1024);
      onDataCallback(largeChunk);

      // 自動 flush で pty:data が送られている
      expect(mockSend).toHaveBeenCalledWith(
        "pty:data",
        expect.objectContaining({
          id: "auto-flush",
          data: expect.stringContaining("x"),
        }),
      );

      // 以降は通常モード
      mockSend.mockClear();
      onDataCallback("normal");
      expect(mockSend).toHaveBeenCalledWith("pty:data", {
        id: "auto-flush",
        data: "normal",
      });
    });

    it("should do nothing for non-existent id", () => {
      mockSend.mockClear();
      ptyManager.flushInitialBuffer("non-existent");
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
