import React, { useEffect, useCallback, useMemo } from "react";
import Header from "./components/Header";
import SplitContainer from "./components/SplitContainer";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { RightSidebar } from "./components/RightSidebar/RightSidebar";
import {
  ErrorToastHost,
  showErrorToast,
} from "./components/Sidebar/ErrorToast";
import { useTerminalMetaStore } from "./stores/terminalMetaStore";
import { PathHoverTooltip } from "./components/PathHoverTooltip";
import { UnsavedChangesModal } from "./components/UnsavedChangesModal";
import {
  useActiveTerminalId,
  useTerminalCount,
  useCanSplit,
  useNodes,
  useRootId,
  useTerminalActions,
  useTerminalStore,
} from "./stores/terminalStore";
import {
  useCurrentTheme,
  useThemeConfig,
  useThemeStore,
} from "./stores/themeStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useSettingsModalStore } from "./stores/settingsModalStore";
import { SettingsModal } from "./components/SettingsModal";
import { getAllTerminalIds } from "./utils/layoutUtils";
import { openMarkdownInRightSidebar } from "./services/markdownOpenService";
import { promptAndInsertFiles } from "./utils/insertFiles";
import * as terminalManager from "./services/terminalManager";
import { useTerminalSearchStore } from "./stores/terminalSearchStore";
import { useFileTreeStore } from "./stores/fileTreeStore";
import { useSidebarStore } from "./stores/sidebarStore";
import { useFileOpsHistoryStore } from "./stores/fileOpsHistoryStore";
import { undoLast, redoLast } from "./services/fileOpsService";
import { startSessionPersist } from "./services/sessionPersist";
import { useMarkdownDialogStore } from "./stores/markdownDialogStore";
import { isMarkdownPath } from "./utils/markdownFile";
import {
  SHORTCUT_DEFINITIONS,
  matchKey,
  resolveShortcutKey,
  type ShortcutId,
} from "./shortcuts/registry";
import {
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  EDITOR_FONT_SIZE_MAX,
  DEFAULT_SETTINGS,
  clampNumber,
} from "../shared/settings";

// xterm の隠し textarea は ASCII 制御のためのプロキシで、ユーザーが直接編集する
// 通常の input/textarea ではない。Cmd+Z 等を sidebar / terminal にディスパッチする
// 判定では「編集中の入力要素」として扱わない。
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT") return true;
  if (tag === "TEXTAREA") {
    return !target.classList.contains("xterm-helper-textarea");
  }
  if (target.isContentEditable) return true;
  return false;
}

// MarkdownEditor (CodeMirror) 内に focus があるかを判定。
function isInsideMarkdownEditor(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest("[data-md-editor-tab]");
}

// MarkdownEditor 内のいずれかの要素に現在 focus があるか（Cmd+= の対象判定用）。
function isMarkdownEditorFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return !!el.closest("[data-md-editor-tab]");
}

// Cmd+= / Cmd+- 共通: フォーカスが MarkdownEditor 内なら editor.fontSize を、
// それ以外（CLI / Sidebar / 何もなし）は terminal.fontSize を動かす。
function adjustGlobalFontSize(delta: number): void {
  const settings = useSettingsStore.getState().settings;
  if (isMarkdownEditorFocused()) {
    const current = settings.editor.fontSize;
    const next = clampNumber(
      current + delta,
      EDITOR_FONT_SIZE_MIN,
      EDITOR_FONT_SIZE_MAX,
      current,
    );
    if (next === current) return;
    useSettingsStore.getState().update({ editor: { fontSize: next } });
    return;
  }
  const current = settings.terminal.fontSize;
  const next = clampNumber(
    current + delta,
    FONT_SIZE_MIN,
    FONT_SIZE_MAX,
    current,
  );
  if (next === current) return;
  useSettingsStore.getState().update({ terminal: { fontSize: next } });
}

// Cmd+0: フォーカスに応じてファクトリーデフォルトに戻す。
function resetGlobalFontSize(): void {
  if (isMarkdownEditorFocused()) {
    useSettingsStore.getState().update({
      editor: { fontSize: DEFAULT_SETTINGS.editor.fontSize },
    });
    return;
  }
  useSettingsStore.getState().update({ terminal: { fontSize: 14 } });
}

const EDITABLE_PASSTHROUGH_IDS: ReadonlySet<ShortcutId> = new Set([
  "kill-line-backward",
  "kill-line-forward",
  "move-line-start",
  "move-line-end",
  "kill-word-backward",
  "kill-word-forward",
  "move-word-left",
  "move-word-right",
  "undo",
  "redo",
  "insert-newline",
]);

const App: React.FC = () => {
  const activeTerminalId = useActiveTerminalId();
  const terminalCount = useTerminalCount();
  const canSplit = useCanSplit();
  const nodes = useNodes();
  const rootId = useRootId();
  const { setActiveTerminal, splitTerminal, closeTerminal } =
    useTerminalActions();

  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  const canSplitNow = canSplit();

  const terminalIds = useMemo(() => getAllTerminalIds(nodes), [nodes]);

  // Markdown ダイアログ要求は markdownDialogStore に集約。App 側で render する。
  // 旧仕様の OpenConfirmRequest（ペイン選択）は廃止し、UnsavedRequest のみ残る。
  const dialogRequest = useMarkdownDialogStore((s) => s.current);
  const dismissDialog = useMarkdownDialogStore((s) => s.dismiss);

  // Sidebar からの「編集する」/シングルクリック要求 → 右サイドバーで開く + 自動オープン。
  const handleRequestEditMarkdown = useCallback((filePath: string): void => {
    if (!isMarkdownPath(filePath)) return;
    void openMarkdownInRightSidebar(filePath);
  }, []);

  const moveFocus = useCallback(
    (direction: "up" | "down" | "left" | "right"): void => {
      if (terminalIds.length <= 1 || !activeTerminalId) return;

      const currentIndex = terminalIds.indexOf(activeTerminalId);
      if (currentIndex === -1) return;

      let nextIndex: number;
      if (direction === "left" || direction === "up") {
        nextIndex =
          currentIndex > 0 ? currentIndex - 1 : terminalIds.length - 1;
      } else {
        nextIndex =
          currentIndex < terminalIds.length - 1 ? currentIndex + 1 : 0;
      }

      setActiveTerminal(terminalIds[nextIndex]);
    },
    [terminalIds, activeTerminalId, setActiveTerminal],
  );

  useEffect(() => {
    const handlers: Partial<Record<ShortcutId, (e: KeyboardEvent) => void>> = {
      "split-vertical": (e) => {
        e.preventDefault();
        if (activeTerminalId && canSplitNow) {
          splitTerminal(activeTerminalId, "horizontal");
        }
      },
      "split-horizontal": (e) => {
        e.preventDefault();
        if (activeTerminalId && canSplitNow) {
          splitTerminal(activeTerminalId, "vertical");
        }
      },
      "select-current-line": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          terminalManager.selectCurrentLine(activeTerminalId);
        }
      },
      "close-pane": (e) => {
        e.preventDefault();
        if (!activeTerminalId || terminalCount <= 1) return;
        // MD タブはアプリグローバル管理に変更されたため、ペイン close 時の dirty
        // 警告は不要（MD タブは右サイドバーで独立管理される）。
        closeTerminal(activeTerminalId);
      },
      "find-in-pane": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          useTerminalSearchStore.getState().toggle(activeTerminalId);
        }
      },
      "reload-tree": (e) => {
        e.preventDefault();
        e.stopPropagation();
        const { isOpen, selectedTabCwd } = useSidebarStore.getState();
        if (isOpen && selectedTabCwd) {
          void useFileTreeStore.getState().refreshAllExpanded(selectedTabCwd);
        }
      },
      "insert-file-path": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          void promptAndInsertFiles(activeTerminalId);
        }
      },
      undo: (e) => {
        const target = e.target as HTMLElement | null;
        if (isEditableTarget(target)) return;
        // MarkdownEditor 内の Cmd+Z は CodeMirror の history に委譲する
        if (isInsideMarkdownEditor(target)) return;
        const sidebarState = useSidebarStore.getState();
        const fileOpsState = useFileOpsHistoryStore.getState();
        const sidebarHasUndo = fileOpsState.undoStack.length > 0;
        if (sidebarState.lastInteractedArea === "sidebar" && sidebarHasUndo) {
          e.preventDefault();
          e.stopPropagation();
          void undoLast();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          terminalManager.undo(activeTerminalId);
        }
      },
      redo: (e) => {
        const target = e.target as HTMLElement | null;
        if (isEditableTarget(target)) return;
        if (isInsideMarkdownEditor(target)) return;
        const sidebarState = useSidebarStore.getState();
        const fileOpsState = useFileOpsHistoryStore.getState();
        const sidebarHasRedo = fileOpsState.redoStack.length > 0;
        if (sidebarState.lastInteractedArea === "sidebar" && sidebarHasRedo) {
          e.preventDefault();
          e.stopPropagation();
          void redoLast();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          terminalManager.redo(activeTerminalId);
        }
      },
      "toggle-sidebar": (e) => {
        e.preventDefault();
        e.stopPropagation();
        useSidebarStore.getState().toggleOpen();
      },
      "kill-line-backward": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          terminalManager.writeWithHistory(activeTerminalId, "\x15"); // Ctrl+U
        }
      },
      "kill-line-forward": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          terminalManager.writeWithHistory(activeTerminalId, "\x0b"); // Ctrl+K
        }
      },
      "move-line-start": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (
          activeTerminalId &&
          terminalManager.isShellReady(activeTerminalId)
        ) {
          window.api.pty.write(activeTerminalId, "\x01"); // Ctrl+A
        }
      },
      "move-line-end": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (
          activeTerminalId &&
          terminalManager.isShellReady(activeTerminalId)
        ) {
          window.api.pty.write(activeTerminalId, "\x05"); // Ctrl+E
        }
      },
      "insert-newline": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          terminalManager.writeWithHistory(activeTerminalId, "\n");
        }
      },
      "kill-word-backward": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          terminalManager.writeWithHistory(activeTerminalId, "\x17"); // Ctrl+W
        }
      },
      "kill-word-forward": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          terminalManager.writeWithHistory(activeTerminalId, "\x1bd"); // ESC+d
        }
      },
      "move-word-left": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (
          activeTerminalId &&
          terminalManager.isShellReady(activeTerminalId)
        ) {
          window.api.pty.write(activeTerminalId, "\x1bb"); // ESC+b
        }
      },
      "move-word-right": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (
          activeTerminalId &&
          terminalManager.isShellReady(activeTerminalId)
        ) {
          window.api.pty.write(activeTerminalId, "\x1bf"); // ESC+f
        }
      },
      "focus-up": (e) => {
        e.preventDefault();
        moveFocus("up");
      },
      "focus-down": (e) => {
        e.preventDefault();
        moveFocus("down");
      },
      "focus-left": (e) => {
        e.preventDefault();
        moveFocus("left");
      },
      "focus-right": (e) => {
        e.preventDefault();
        moveFocus("right");
      },
      "open-settings": (e) => {
        e.preventDefault();
        useSettingsModalStore.getState().open();
      },
      "change-directory": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!activeTerminalId) return;
        void window.api.dialog.selectDirectory().then((selectedPath) => {
          if (!selectedPath || !activeTerminalId) return;
          // シングルクオート安全化（'\'' でクオート閉じ→エスケープ→再開）
          const escaped = selectedPath.replace(/'/g, "'\\''");
          window.api.pty.write(activeTerminalId, `cd '${escaped}'\n`);
        });
      },
      "open-in-vscode": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!activeTerminalId) return;
        const meta = useTerminalMetaStore
          .getState()
          .metas.get(activeTerminalId);
        const target = meta?.cwd;
        if (!target) {
          showErrorToast("アクティブなターミナルの CWD が取得できません");
          return;
        }
        void window.api.fs.openInVSCode(target).then((res) => {
          if (!res.ok) {
            showErrorToast(
              "VSCode を起動できませんでした（`code` コマンドが PATH にありますか？）",
            );
          }
        });
      },
      "toggle-fullscreen": (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.api.window.toggleFullScreen();
      },
      "focus-file-search": (e) => {
        e.preventDefault();
        e.stopPropagation();
        const input = document.getElementById("header-file-search");
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
      },
      "font-zoom-in": (e) => {
        e.preventDefault();
        e.stopPropagation();
        adjustGlobalFontSize(+1);
      },
      "font-zoom-out": (e) => {
        e.preventDefault();
        e.stopPropagation();
        adjustGlobalFontSize(-1);
      },
      "font-zoom-reset": (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetGlobalFontSize();
      },
    };

    const handleKeyDown = (e: KeyboardEvent): void => {
      // フォントズームは IME ガードより先に処理する。
      if (e.metaKey && !e.ctrlKey && !e.altKey) {
        const earlyBindings = useSettingsStore.getState().settings.shortcuts;
        const zoomInKey = resolveShortcutKey("font-zoom-in", earlyBindings);
        const zoomOutKey = resolveShortcutKey("font-zoom-out", earlyBindings);
        const zoomResetKey = resolveShortcutKey(
          "font-zoom-reset",
          earlyBindings,
        );
        const isZoomIn =
          zoomInKey !== null &&
          !e.shiftKey &&
          (e.key === ";" || e.code === "Semicolon");
        const isZoomOut =
          zoomOutKey !== null &&
          !e.shiftKey &&
          (e.key === "-" || e.code === "Minus" || e.keyCode === 189);
        const isZoomReset =
          zoomResetKey !== null &&
          !e.shiftKey &&
          (e.key === "0" || e.code === "Digit0" || e.keyCode === 48);
        if (
          isZoomIn &&
          useSettingsModalStore.getState().recordingShortcutId === null
        ) {
          handlers["font-zoom-in"]?.(e);
          return;
        }
        if (
          isZoomOut &&
          useSettingsModalStore.getState().recordingShortcutId === null
        ) {
          handlers["font-zoom-out"]?.(e);
          return;
        }
        if (
          isZoomReset &&
          useSettingsModalStore.getState().recordingShortcutId === null
        ) {
          handlers["font-zoom-reset"]?.(e);
          return;
        }
      }

      if (e.isComposing || e.keyCode === 229) return;

      if (useSettingsModalStore.getState().recordingShortcutId !== null) return;

      if (e.metaKey && e.shiftKey && !e.altKey) {
        if (
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown"
        ) {
          e.preventDefault();
          e.stopPropagation();
          if (activeTerminalId) {
            terminalManager.selectCurrentLine(activeTerminalId);
          }
          return;
        }
      }

      const bindings = useSettingsStore.getState().settings.shortcuts;
      const inEditable = isEditableTarget(e.target);

      for (const def of SHORTCUT_DEFINITIONS) {
        const resolved = resolveShortcutKey(def.id, bindings);
        if (resolved && matchKey(e, resolved)) {
          if (inEditable && EDITABLE_PASSTHROUGH_IDS.has(def.id)) return;
          handlers[def.id]?.(e);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    activeTerminalId,
    splitTerminal,
    closeTerminal,
    canSplitNow,
    terminalCount,
    moveFocus,
  ]);

  // 表示メニューからのフォントズーム IPC を購読する。
  useEffect(() => {
    const offIn = window.api.menu.onFontZoomIn(() => {
      adjustGlobalFontSize(+1);
    });
    const offOut = window.api.menu.onFontZoomOut(() => {
      adjustGlobalFontSize(-1);
    });
    const offReset = window.api.menu.onFontZoomReset(() => {
      resetGlobalFontSize();
    });
    return () => {
      offIn();
      offOut();
      offReset();
    };
  }, []);

  // セッション永続化
  useEffect(() => {
    return startSessionPersist();
  }, []);

  // アプリ全体ズームを WebFrame に反映する。
  const appZoomFactor = useSettingsStore(
    (s) => s.settings.general.appZoomFactor,
  );
  useEffect(() => {
    window.api.window.setZoomFactor(appZoomFactor);
  }, [appZoomFactor]);

  // 起動時に settings をロード
  useEffect(() => {
    void useSettingsStore
      .getState()
      .load()
      .then((loaded) => {
        useThemeStore.getState().setThemeIdLocal(loaded.theme.currentThemeId);
      });
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        backgroundColor: theme.colors.background,
      }}
    >
      <Header />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "row",
          overflow: "hidden",
        }}
      >
        <Sidebar onRequestEditMarkdown={handleRequestEditMarkdown} />
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <SplitContainer />
        </div>
        <RightSidebar />
      </div>
      <ErrorToastHost />
      <PathHoverTooltip />
      {dialogRequest?.kind === "unsaved" && (
        <UnsavedChangesModal
          isOpen
          filePath={dialogRequest.filePath}
          reason={dialogRequest.reason}
          onSave={dialogRequest.onSave}
          onDiscard={dialogRequest.onDiscard}
          onCancel={dismissDialog}
        />
      )}
      <SettingsModal />
    </div>
  );
};

export default App;
