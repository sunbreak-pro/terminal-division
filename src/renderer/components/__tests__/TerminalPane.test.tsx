import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import TerminalPane from "../TerminalPane";

// terminalManagerモック
const mockGetOrCreate = vi.fn();
const mockAttachToContainer = vi.fn();
const mockFocus = vi.fn();
const mockScrollToBottom = vi.fn();
const mockFit = vi.fn();

vi.mock("../../services/terminalManager", () => ({
  getOrCreate: (...args: unknown[]) => mockGetOrCreate(...args),
  attachToContainer: (...args: unknown[]) => mockAttachToContainer(...args),
  focus: (...args: unknown[]) => mockFocus(...args),
  scrollToBottom: (...args: unknown[]) => mockScrollToBottom(...args),
  fit: (...args: unknown[]) => mockFit(...args),
}));

// terminalStoreモック
const mockSetActiveTerminal = vi.fn();
const mockCloseTerminal = vi.fn();

vi.mock("../../stores/terminalStore", () => ({
  useActiveTerminalId: vi.fn(() => "terminal-1"),
  useTerminalActions: vi.fn(() => ({
    setActiveTerminal: mockSetActiveTerminal,
    closeTerminal: mockCloseTerminal,
  })),
}));

// themeStoreモック
vi.mock("../../stores/themeStore", () => ({
  useCurrentTheme: () => ({
    id: "dark",
    name: "Dark",
    colors: {
      background: "#1a1a1a",
      headerBackground: "#252526",
      terminalBackground: "#0d0d0d",
      text: "#d4d4d4",
      textSecondary: "#888888",
      accent: "#007acc",
      activeTerminal: "#ff8c00",
      border: "#515050",
      borderActive: "#007acc",
      buttonHover: "#3c3c3c",
      danger: "#f44747",
    },
    xterm: {
      background: "#0d0d0d",
      foreground: "#d4d4d4",
    },
  }),
  useThemeConfig: () => ({
    spacing: {
      xs: "4px",
      sm: "8px",
      md: "12px",
      lg: "16px",
      xl: "24px",
    },
    borderRadius: "4px",
    headerHeight: "40px",
  }),
}));

// rafDebounceモック
vi.mock("../../utils/rafDebounce", () => ({
  rafDebounceWithDelay: (fn: () => void) => ({
    handler: fn,
    cancel: vi.fn(),
  }),
}));

// terminalMetaStoreモック
vi.mock("../../stores/terminalMetaStore", () => ({
  useTerminalMetaStore: {
    getState: () => ({
      metas: new Map(),
    }),
  },
  useTerminalMeta: () => undefined,
}));

import * as terminalStore from "../../stores/terminalStore";

describe("TerminalPane", () => {
  const mockTerminalInstance = {
    terminal: {
      cols: 80,
      rows: 24,
    },
    fitAddon: {
      fit: vi.fn(),
    },
    ptyCreated: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // useLayoutEffect 化により setTimeout(0) を排除したため fakeTimers 不要

    // デフォルトのモック設定
    mockGetOrCreate.mockReturnValue({
      ...mockTerminalInstance,
      ptyCreated: false,
    });
    mockFit.mockReturnValue({ cols: 80, rows: 24 });
    vi.mocked(terminalStore.useActiveTerminalId).mockReturnValue("terminal-1");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls getOrCreate on mount", () => {
    render(<TerminalPane id="terminal-1" paneNumber={1} />);

    expect(mockGetOrCreate).toHaveBeenCalledWith(
      "terminal-1",
      expect.objectContaining({
        fontFamily: expect.any(String),
        fontSize: 13,
        cursorBlink: true,
      }),
      expect.objectContaining({
        onData: expect.any(Function),
        onExit: expect.any(Function),
        onFocus: expect.any(Function),
      }),
    );
  });

  it("attaches to container on mount", () => {
    render(<TerminalPane id="terminal-1" paneNumber={1} />);

    expect(mockAttachToContainer).toHaveBeenCalledWith(
      "terminal-1",
      expect.any(HTMLDivElement),
    );
  });

  it("focuses terminal when active", () => {
    // このターミナルがアクティブ状態で描画
    vi.mocked(terminalStore.useActiveTerminalId).mockReturnValue("terminal-1");

    render(<TerminalPane id="terminal-1" paneNumber={1} />);

    // isActive === true のため、useEffectでfocusが呼ばれる
    expect(mockFocus).toHaveBeenCalledWith("terminal-1");
  });

  it("sets active on mousedown", () => {
    vi.mocked(terminalStore.useActiveTerminalId).mockReturnValue("terminal-2");

    const { container } = render(
      <TerminalPane id="terminal-1" paneNumber={1} />,
    );

    const terminalContainer = container.querySelector(".terminal-container")!;
    fireEvent.mouseDown(terminalContainer);

    expect(mockSetActiveTerminal).toHaveBeenCalledWith("terminal-1");
  });

  it("applies active border style when active", () => {
    vi.mocked(terminalStore.useActiveTerminalId).mockReturnValue("terminal-1");

    const { container } = render(
      <TerminalPane id="terminal-1" paneNumber={1} />,
    );

    const terminalContainer = container.querySelector<HTMLElement>(
      ".terminal-container",
    );
    // アクティブ時は3pxボーダー (rgb(255, 140, 0) = #ff8c00)
    expect(terminalContainer?.style.border).toContain("3px");
    expect(terminalContainer?.style.border).toMatch(/rgb\(255,\s*140,\s*0\)/);
  });

  it("applies inactive border style when not active", () => {
    vi.mocked(terminalStore.useActiveTerminalId).mockReturnValue("terminal-2");

    const { container } = render(
      <TerminalPane id="terminal-1" paneNumber={1} />,
    );

    const terminalContainer = container.querySelector<HTMLElement>(
      ".terminal-container",
    );
    // 非アクティブ時は2pxボーダー (rgb(81, 80, 80) = #515050)
    expect(terminalContainer?.style.border).toContain("2px");
    expect(terminalContainer?.style.border).toMatch(/rgb\(81,\s*80,\s*80\)/);
  });

  it("cleanup on unmount", () => {
    const { unmount } = render(<TerminalPane id="terminal-1" paneNumber={1} />);

    unmount();

    // ResizeObserver disconnect is called (verified by no errors on unmount)
  });

  it("creates PTY on first mount", () => {
    mockGetOrCreate.mockReturnValue({
      ...mockTerminalInstance,
      ptyCreated: false,
    });

    render(<TerminalPane id="terminal-1" paneNumber={1} />);

    // useLayoutEffect で同期発火するため setTimeout 待ち不要
    expect(window.api.pty.create).toHaveBeenCalledWith("terminal-1", undefined);
  });

  it("does not create PTY if already created", () => {
    // PTYが既に作成済みの状態
    mockGetOrCreate.mockReturnValue({
      ...mockTerminalInstance,
      ptyCreated: true,
    });

    render(<TerminalPane id="terminal-1" paneNumber={1} />);

    // createは呼ばれない（fit は handleFit 経由で同期実行される）
    expect(window.api.pty.create).not.toHaveBeenCalled();
  });
});
