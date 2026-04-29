import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// markdownEditorRegistry をモック化（getApi が undefined を返す = dirty 判定回避）
vi.mock("../markdownEditorRegistry", () => ({
  getApi: vi.fn(() => undefined),
}));

// fs.readFile / openMarkdown の実体は走らせず、呼び出しだけ確認する
const readFileMock = vi.fn();
const openMarkdownMock = vi.fn();
const setActiveTerminalMock = vi.fn();
const splitTerminalMock = vi.fn();
const canSplitMock = vi.fn();

vi.stubGlobal("window", {
  api: {
    fs: {
      readFile: (...args: unknown[]) => readFileMock(...args),
    },
  },
});

// terminalMetaStore: cwd / mdDirty を制御するため後から差し替え可能に
const metaState = {
  metas: new Map<
    string,
    {
      cwd: string | null;
      viewMode: string;
      mdDirty: boolean;
      mdFilePath: string | null;
    }
  >(),
  openMarkdown: (...args: unknown[]) => openMarkdownMock(...args),
};
vi.mock("../../stores/terminalMetaStore", () => ({
  useTerminalMetaStore: { getState: () => metaState },
}));

// terminalStore: 1 ペインのみ、splitTerminal は新ペイン id を activeTerminalId に設定
const storeState = {
  rootId: "p1",
  nodes: new Map([["p1", { id: "p1", parentId: null }]]),
  activeTerminalId: "p1",
  setActiveTerminal: (...args: unknown[]) => setActiveTerminalMock(...args),
  splitTerminal: (...args: unknown[]) => {
    splitTerminalMock(...args);
    storeState.activeTerminalId = "p2"; // 分割後の新ペイン id
    return true;
  },
  canSplit: () => canSplitMock(),
};
vi.mock("../../stores/terminalStore", () => ({
  useTerminalStore: { getState: () => storeState },
}));

// markdownDialogStore: showOpenConfirm 等の呼び出しだけ捕まえる
const showOpenConfirmMock = vi.fn();
const showUnsavedMock = vi.fn();
const dismissMock = vi.fn();
vi.mock("../../stores/markdownDialogStore", () => ({
  useMarkdownDialogStore: {
    getState: () => ({
      showOpenConfirm: showOpenConfirmMock,
      showUnsaved: showUnsavedMock,
      dismiss: dismissMock,
    }),
  },
}));

vi.mock("../../components/Sidebar/ErrorToast", () => ({
  showErrorToast: vi.fn(),
}));

import {
  requestEditMarkdownFromTerminal,
  requestEditMarkdownFromSidebar,
  NEW_PANE_CHOICE,
} from "../markdownOpenService";

describe("markdownOpenService", () => {
  beforeEach(() => {
    readFileMock.mockReset();
    openMarkdownMock.mockReset();
    setActiveTerminalMock.mockReset();
    splitTerminalMock.mockReset();
    canSplitMock.mockReset();
    showOpenConfirmMock.mockReset();
    showUnsavedMock.mockReset();
    dismissMock.mockReset();
    metaState.metas = new Map();
    storeState.activeTerminalId = "p1";
    storeState.rootId = "p1";
    storeState.nodes = new Map([["p1", { id: "p1", parentId: null }]]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("requestEditMarkdownFromTerminal", () => {
    it("opens directly (no dialog) when file is inside the originating pane CWD", async () => {
      metaState.metas.set("p1", {
        cwd: "/work",
        viewMode: "cli",
        mdDirty: false,
        mdFilePath: null,
      });
      readFileMock.mockResolvedValue({ ok: true, content: "# hi" });

      requestEditMarkdownFromTerminal("/work/sub/foo.md", "p1");
      // openMarkdownInPane は async。次の microtask で fs.readFile が呼ばれる
      await Promise.resolve();
      await Promise.resolve();

      expect(showOpenConfirmMock).not.toHaveBeenCalled();
      expect(readFileMock).toHaveBeenCalledWith("/work/sub/foo.md");
    });

    it("shows dialog (with allowCreateNewPane=true) when file is outside CWD", () => {
      metaState.metas.set("p1", {
        cwd: "/work",
        viewMode: "cli",
        mdDirty: false,
        mdFilePath: null,
      });

      requestEditMarkdownFromTerminal("/other/foo.md", "p1");

      expect(showOpenConfirmMock).toHaveBeenCalledTimes(1);
      const arg = showOpenConfirmMock.mock.calls[0][0];
      expect(arg.filePath).toBe("/other/foo.md");
      expect(arg.allowCreateNewPane).toBe(true);
      expect(arg.defaultPaneId).toBe("p1");
      expect(arg.availablePanes).toEqual([{ paneId: "p1", paneNumber: 1 }]);
    });

    it("shows dialog when CWD is unknown (cannot judge inside/outside)", () => {
      // meta 未登録: cwd 取得不能 → 安全側でダイアログ
      requestEditMarkdownFromTerminal("/any/foo.md", "p1");
      expect(showOpenConfirmMock).toHaveBeenCalledTimes(1);
    });

    it("ignores non-markdown paths defensively", () => {
      requestEditMarkdownFromTerminal("/work/foo.txt", "p1");
      expect(showOpenConfirmMock).not.toHaveBeenCalled();
      expect(readFileMock).not.toHaveBeenCalled();
    });

    it("triggers unsaved warning when current pane has dirty MD inside CWD", () => {
      metaState.metas.set("p1", {
        cwd: "/work",
        viewMode: "md",
        mdDirty: true,
        mdFilePath: "/work/dirty.md",
      });

      requestEditMarkdownFromTerminal("/work/new.md", "p1");

      expect(showUnsavedMock).toHaveBeenCalledTimes(1);
      const arg = showUnsavedMock.mock.calls[0][0];
      expect(arg.filePath).toBe("/work/dirty.md");
      expect(arg.paneId).toBe("p1");
    });
  });

  describe("requestEditMarkdownFromSidebar", () => {
    it("always shows dialog with allowCreateNewPane=true", () => {
      metaState.metas.set("p1", {
        cwd: "/work",
        viewMode: "cli",
        mdDirty: false,
        mdFilePath: null,
      });
      requestEditMarkdownFromSidebar("/work/in-cwd.md", "p1");
      expect(showOpenConfirmMock).toHaveBeenCalledTimes(1);
      expect(showOpenConfirmMock.mock.calls[0][0].allowCreateNewPane).toBe(
        true,
      );
    });

    it("ignores non-markdown paths defensively", () => {
      requestEditMarkdownFromSidebar("/work/foo.txt", "p1");
      expect(showOpenConfirmMock).not.toHaveBeenCalled();
    });
  });

  describe("NEW_PANE_CHOICE handling via dialog onConfirm", () => {
    it("splits the originating pane and opens MD in the new pane", async () => {
      metaState.metas.set("p1", {
        cwd: "/work",
        viewMode: "cli",
        mdDirty: false,
        mdFilePath: null,
      });
      canSplitMock.mockReturnValue(true);
      readFileMock.mockResolvedValue({ ok: true, content: "# hi" });

      requestEditMarkdownFromTerminal("/other/x.md", "p1");
      const onConfirm = showOpenConfirmMock.mock.calls[0][0].onConfirm as (
        c: string,
      ) => void;

      onConfirm(NEW_PANE_CHOICE);
      // openMarkdownInNewPane は async
      await Promise.resolve();
      await Promise.resolve();

      expect(splitTerminalMock).toHaveBeenCalledWith("p1", "horizontal");
      expect(readFileMock).toHaveBeenCalledWith("/other/x.md");
    });

    it("aborts split when canSplit returns false (max panes reached)", async () => {
      metaState.metas.set("p1", {
        cwd: "/work",
        viewMode: "cli",
        mdDirty: false,
        mdFilePath: null,
      });
      canSplitMock.mockReturnValue(false);

      requestEditMarkdownFromTerminal("/other/x.md", "p1");
      const onConfirm = showOpenConfirmMock.mock.calls[0][0].onConfirm as (
        c: string,
      ) => void;
      onConfirm(NEW_PANE_CHOICE);
      await Promise.resolve();

      expect(splitTerminalMock).not.toHaveBeenCalled();
      expect(readFileMock).not.toHaveBeenCalled();
    });
  });
});
