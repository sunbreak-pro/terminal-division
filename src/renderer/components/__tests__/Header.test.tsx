import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Header from "../Header";

// terminalStoreモック（Header は閉じるボタンを持たないため close 系は不要）
const mockSplitTerminal = vi.fn();
const mockSetActiveTerminal = vi.fn();

vi.mock("../../stores/terminalStore", () => ({
  useActiveTerminalId: vi.fn(() => "terminal-1"),
  useCanSplit: vi.fn(() => () => true),
  useTerminalActions: vi.fn(() => ({
    splitTerminal: mockSplitTerminal,
    setActiveTerminal: mockSetActiveTerminal,
  })),
}));

// themeStoreモック（テーマセレクタは Settings に移動したのでここでは最低限）
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
    xterm: {},
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

// terminalManagerモック
vi.mock("../../services/terminalManager", () => ({
  updateAllThemes: vi.fn(),
}));

// terminalStoreモジュールの参照を取得
import * as terminalStore from "../../stores/terminalStore";

describe("Header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.api.dialog.selectDirectory).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the kept buttons (split / directory) and the center search field", () => {
    render(<Header />);

    expect(screen.getByTitle("縦に分割 (Cmd+D)")).toBeInTheDocument();
    expect(screen.getByTitle("横に分割 (Cmd+Shift+D)")).toBeInTheDocument();
    expect(screen.getByTitle("ディレクトリを移動")).toBeInTheDocument();
    // 検索フィールド: Header 中央へ移設
    expect(screen.getByPlaceholderText("ファイル名で検索")).toBeInTheDocument();
  });

  it("does NOT render the settings button (moved to Sidebar)", () => {
    render(<Header />);
    expect(screen.queryByTitle("設定 (Cmd+,)")).not.toBeInTheDocument();
  });

  it("does NOT render the close button (moved to per-pane SubHeader)", () => {
    render(<Header />);
    expect(screen.queryByTitle("閉じる (Cmd+W)")).not.toBeInTheDocument();
  });

  it("does NOT render the theme selector (moved to Settings)", () => {
    render(<Header />);
    expect(screen.queryByTitle("テーマ選択")).not.toBeInTheDocument();
  });

  it("split buttons disabled when canSplit=false", () => {
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => false);

    render(<Header />);

    const verticalSplitButton = screen.getByTitle("縦に分割 (Cmd+D)");
    const horizontalSplitButton = screen.getByTitle("横に分割 (Cmd+Shift+D)");

    expect(verticalSplitButton).toBeDisabled();
    expect(horizontalSplitButton).toBeDisabled();
  });

  it('calls splitTerminal("horizontal") on vertical split button click', () => {
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => true);

    render(<Header />);

    const verticalSplitButton = screen.getByTitle("縦に分割 (Cmd+D)");
    fireEvent.click(verticalSplitButton);

    expect(mockSplitTerminal).toHaveBeenCalledWith("terminal-1", "horizontal");
  });

  it('calls splitTerminal("vertical") on horizontal split button click', () => {
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => true);

    render(<Header />);

    const horizontalSplitButton = screen.getByTitle("横に分割 (Cmd+Shift+D)");
    fireEvent.click(horizontalSplitButton);

    expect(mockSplitTerminal).toHaveBeenCalledWith("terminal-1", "vertical");
  });

  it("exposes id=header-file-search on the search input for focus shortcut", () => {
    render(<Header />);
    const byId = document.getElementById("header-file-search");
    expect(byId).toBeInstanceOf(HTMLInputElement);
    // placeholder 経由でも同じ要素を取れること（ショートカットと UI ラベルが同じ input を指す）
    expect(byId).toBe(screen.getByPlaceholderText("ファイル名で検索"));
  });

  it("center search field writes to sidebarStore.searchQuery", async () => {
    const { useSidebarStore } = await import("../../stores/sidebarStore");
    useSidebarStore.setState({ searchQuery: "" });

    render(<Header />);

    const input = screen.getByPlaceholderText("ファイル名で検索");
    fireEvent.change(input, { target: { value: "foo.md" } });

    expect(useSidebarStore.getState().searchQuery).toBe("foo.md");
  });

  it("calls directory selection dialog on directory button click", async () => {
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => true);
    vi.mocked(window.api.dialog.selectDirectory).mockResolvedValue(
      "/some/path",
    );

    render(<Header />);

    const directoryButton = screen.getByTitle("ディレクトリを移動");
    fireEvent.click(directoryButton);

    await waitFor(() => {
      expect(window.api.dialog.selectDirectory).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(window.api.pty.write).toHaveBeenCalledWith(
        "terminal-1",
        "cd '/some/path'\n",
      );
    });
  });

  it("directory button disabled when no active terminal", () => {
    vi.mocked(terminalStore.useActiveTerminalId).mockReturnValue(null);
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => true);

    render(<Header />);

    const directoryButton = screen.getByTitle("ディレクトリを移動");
    expect(directoryButton).toBeDisabled();
  });
});
