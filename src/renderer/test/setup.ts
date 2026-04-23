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
  onData: vi.fn().mockReturnValue(() => {}),
  onExit: vi.fn().mockReturnValue(() => {}),
};

// window.api.dialogモック
const mockDialogApi = {
  selectDirectory: vi.fn().mockResolvedValue(null),
  selectFiles: vi.fn().mockResolvedValue(null),
};

// window.api.themeモック
const mockThemeApi = {
  notifyChanged: vi.fn(),
  onSync: vi.fn().mockReturnValue(() => {}),
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

Object.defineProperty(window, "api", {
  value: {
    pty: mockPtyApi,
    dialog: mockDialogApi,
    theme: mockThemeApi,
    window: mockWindowApi,
    system: mockSystemApi,
    recentDirs: mockRecentDirsApi,
    shell: mockShellApi,
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
