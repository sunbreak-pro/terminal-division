import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { OpenMarkdownModal } from "../OpenMarkdownModal";
import type { PaneChoice } from "../../stores/markdownDialogStore";

vi.mock("../../stores/themeStore", () => ({
  useCurrentTheme: () => ({
    id: "dark",
    colors: {
      background: "#000",
      headerBackground: "#111",
      text: "#fff",
      textSecondary: "#aaa",
      accent: "#ff8c00",
      border: "#333",
      buttonHover: "#222",
      activeTerminal: "#ff8c00",
      borderActive: "#ff8c00",
      danger: "#f00",
      terminalBackground: "#000",
    },
    xterm: {},
  }),
  useThemeConfig: () => ({
    spacing: { xs: "4px", sm: "8px", md: "12px", lg: "16px", xl: "20px" },
    borderRadius: "4px",
  }),
}));

describe("OpenMarkdownModal", () => {
  const panes: PaneChoice[] = [
    { paneId: "p1", paneNumber: 1 },
    { paneId: "p2", paneNumber: 2 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when isOpen=false", () => {
    const { container } = render(
      <OpenMarkdownModal
        isOpen={false}
        filePath="/tmp/foo.md"
        availablePanes={panes}
        defaultPaneId="p1"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("calls onConfirm with the default paneId on confirm", () => {
    const onConfirm = vi.fn();
    render(
      <OpenMarkdownModal
        isOpen
        filePath="/tmp/foo.md"
        availablePanes={panes}
        defaultPaneId="p2"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("はい"));
    expect(onConfirm).toHaveBeenCalledWith("p2");
  });

  it("calls onCancel when ESC is pressed", () => {
    const onCancel = vi.fn();
    render(
      <OpenMarkdownModal
        isOpen
        filePath="/tmp/foo.md"
        availablePanes={panes}
        defaultPaneId="p1"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("does not render '+ 新規パネルを作成' option by default", () => {
    render(
      <OpenMarkdownModal
        isOpen
        filePath="/tmp/foo.md"
        availablePanes={panes}
        defaultPaneId="p1"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText("+ 新規パネルを作成")).toBeNull();
  });

  it("renders '+ 新規パネルを作成' when allowCreateNewPane is true", () => {
    render(
      <OpenMarkdownModal
        isOpen
        filePath="/tmp/foo.md"
        availablePanes={panes}
        defaultPaneId="p1"
        allowCreateNewPane
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("+ 新規パネルを作成")).toBeInTheDocument();
  });

  it("passes the new-pane sentinel '__new__' to onConfirm when selected", () => {
    const onConfirm = vi.fn();
    render(
      <OpenMarkdownModal
        isOpen
        filePath="/tmp/foo.md"
        availablePanes={panes}
        defaultPaneId="p1"
        allowCreateNewPane
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "__new__" } });
    fireEvent.click(screen.getByText("はい"));
    expect(onConfirm).toHaveBeenCalledWith("__new__");
  });

  it("renders select even when only 1 pane exists if allowCreateNewPane is true", () => {
    render(
      <OpenMarkdownModal
        isOpen
        filePath="/tmp/foo.md"
        availablePanes={[{ paneId: "p1", paneNumber: 1 }]}
        defaultPaneId="p1"
        allowCreateNewPane
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("+ 新規パネルを作成")).toBeInTheDocument();
  });
});
