import "@testing-library/jest-dom";
import { vi } from "vitest";

// ResizeObserverモック
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// window.api.ptyモック
const mockPtyApi = {
  create: vi.fn().mockResolvedValue("mock-pty-id"),
  write: vi.fn(),
  resize: vi.fn(),
  destroy: vi.fn(),
  kill: vi.fn(),
  flushInitialBuffer: vi.fn(),
  onData: vi.fn().mockReturnValue(() => {}),
  onExit: vi.fn().mockReturnValue(() => {}),
};

// window.api.dialogモック
const mockDialogApi = {
  selectDirectory: vi.fn().mockResolvedValue(null),
  selectFiles: vi.fn().mockResolvedValue(null),
};

// window.api.windowモック
const mockWindowApi = {
  getInitialCwd: vi.fn().mockReturnValue(null),
};

// window.api.systemモック
const mockSystemApi = {
  getHomeDir: vi.fn().mockReturnValue("/Users/test"),
};

// window.api.recentDirsモック
const mockRecentDirsApi = {
  add: vi.fn(),
};

// window.api.shellモック
const mockShellApi = {
  openExternal: vi.fn(),
};

// window.api.session モック（onSaveFailed 等の listener は no-op で返す）
const mockSessionApi = {
  save: vi.fn(),
  clear: vi.fn(),
  getRestoreData: vi.fn().mockResolvedValue(null),
  onSaveFailed: vi.fn().mockReturnValue(() => {}),
};

// window.api.fs モック（onWatcherError 等の listener は no-op で返す）
const mockFsApi = {
  onChange: vi.fn().mockReturnValue(() => {}),
  onWatcherError: vi.fn().mockReturnValue(() => {}),
};

Object.defineProperty(window, "api", {
  value: {
    pty: mockPtyApi,
    dialog: mockDialogApi,
    window: mockWindowApi,
    system: mockSystemApi,
    recentDirs: mockRecentDirsApi,
    shell: mockShellApi,
    session: mockSessionApi,
    fs: mockFsApi,
  },
  writable: true,
});

// matchMediaモック（テーマ検出用）
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
