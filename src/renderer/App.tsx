import React, { useEffect, useCallback, useMemo } from "react";
import Header from "./components/Header";
import SplitContainer from "./components/SplitContainer";
import { Sidebar } from "./components/Sidebar/Sidebar";
import {
  ErrorToastHost,
  showErrorToast,
} from "./components/Sidebar/ErrorToast";
import { OpenMarkdownModal } from "./components/OpenMarkdownModal";
import { UnsavedChangesModal } from "./components/UnsavedChangesModal";
import {
  useActiveTerminalId,
  useTerminalCount,
  useCanSplit,
  useNodes,
  useRootId,
  useTerminalActions,
} from "./stores/terminalStore";
import {
  useCurrentTheme,
  useThemeConfig,
  useThemeStore,
} from "./stores/themeStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useSettingsModalStore } from "./stores/settingsModalStore";
import { SettingsModal } from "./components/SettingsModal";
import { getAllTerminalIds, collectPaneIdsInOrder } from "./utils/layoutUtils";
import { promptAndInsertFiles } from "./utils/insertFiles";
import * as terminalManager from "./services/terminalManager";
import { useTerminalSearchStore } from "./stores/terminalSearchStore";
import { useFileTreeStore } from "./stores/fileTreeStore";
import { useSidebarStore } from "./stores/sidebarStore";
import { useFileOpsHistoryStore } from "./stores/fileOpsHistoryStore";
import { undoLast, redoLast } from "./services/fileOpsService";
import { startSessionPersist } from "./services/sessionPersist";
import { useTerminalMetaStore } from "./stores/terminalMetaStore";
import { useMarkdownDialogStore } from "./stores/markdownDialogStore";
import { isMarkdownPath } from "./utils/markdownFile";
import * as markdownEditorRegistry from "./services/markdownEditorRegistry";
import {
  SHORTCUT_DEFINITIONS,
  matchKey,
  resolveShortcutKey,
  type ShortcutId,
} from "./shortcuts/registry";
import { FONT_SIZE_MIN, FONT_SIZE_MAX, clampNumber } from "../shared/settings";

// アクティブペインのフォントサイズを delta だけ動かす（Cmd+= / Cmd+-）。
// 現在の有効サイズ（override or グローバル）を起点に ±1px、クランプ範囲を適用。
function adjustActivePaneFontSize(paneId: string, delta: number): void {
  const meta = useTerminalMetaStore.getState().metas.get(paneId);
  const settings = useSettingsStore.getState().settings.terminal;
  const current = meta?.fontSizeOverride ?? settings.fontSize;
  const next = clampNumber(
    current + delta,
    FONT_SIZE_MIN,
    FONT_SIZE_MAX,
    current,
  );
  if (next === current) return;
  useTerminalMetaStore.getState().setFontSizeOverride(paneId, next);
}

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

// MarkdownEditor (CodeMirror) 内に focus があるかを判定。data-md-editor-pane を
// MarkdownEditor の root に付けてあるので、closest() で検出する。
function isInsideMarkdownEditor(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest("[data-md-editor-pane]");
}

// 通常の input/textarea にフォーカスがあるときは、ブラウザ標準のテキスト編集
// 動作 (Cmd+Backspace で行頭まで削除 / Cmd+ArrowLeft で行頭移動 / Cmd+Z で undo 等)
// を尊重する必要があるショートカット。これらは capture phase で横取りせず、
// イベントをそのまま input に通す。
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
  const dialogRequest = useMarkdownDialogStore((s) => s.current);
  const dismissDialog = useMarkdownDialogStore((s) => s.dismiss);
  const showOpenConfirm = useMarkdownDialogStore((s) => s.showOpenConfirm);
  const showUnsaved = useMarkdownDialogStore((s) => s.showUnsaved);

  // 「直近フォーカスペイン」を取得。activeTerminalId が null の場合は rootId が
  // 葉なら rootId を使い、葉でなければ最初の葉にフォールバック。
  const resolveTargetPaneId = useCallback((): string | null => {
    if (activeTerminalId) return activeTerminalId;
    if (terminalIds.length > 0) return terminalIds[0];
    return null;
  }, [activeTerminalId, terminalIds]);

  // 指定ペインで Markdown を開くフロー: ファイル読込 → openMarkdown → タブ MD に切替
  const openMarkdownInPane = useCallback(
    async (paneId: string, filePath: string): Promise<void> => {
      const result = await window.api.fs.readFile(filePath);
      if (!result.ok) {
        showErrorToast(`ファイル読込に失敗しました: ${result.error}`);
        return;
      }
      useTerminalMetaStore
        .getState()
        .openMarkdown(paneId, filePath, result.content);
      setActiveTerminal(paneId);
    },
    [setActiveTerminal],
  );

  // Sidebar からの「編集する」要求 → 確認モーダル → 開く
  const handleRequestEditMarkdown = useCallback(
    (filePath: string): void => {
      if (!isMarkdownPath(filePath)) return; // 念のため
      const defaultPaneId = resolveTargetPaneId();
      if (!defaultPaneId) {
        showErrorToast("対象ペインが見つかりません");
        return;
      }
      // ダイアログで切替できる候補。ペイン番号付与は DFS 順 (= getPaneNumber と同じ)
      const orderedIds = rootId ? collectPaneIdsInOrder(rootId, nodes) : [];
      const availablePanes = orderedIds.map((paneId, idx) => ({
        paneId,
        paneNumber: idx + 1,
      }));
      const meta = useTerminalMetaStore.getState().metas.get(defaultPaneId);
      // 選択ペインが dirty な MD を編集中なら、先に未保存警告を出す
      const openConfirm = (): void => {
        showOpenConfirm({
          filePath,
          availablePanes,
          defaultPaneId,
          onConfirm: (chosenPaneId) => {
            dismissDialog();
            void openMarkdownInPane(chosenPaneId, filePath);
          },
        });
      };
      if (meta && meta.viewMode === "md" && meta.mdDirty && meta.mdFilePath) {
        showUnsaved({
          filePath: meta.mdFilePath,
          paneId: defaultPaneId,
          reason: "open-other",
          onSave: async () => {
            const api = markdownEditorRegistry.getApi(defaultPaneId);
            const ok = api ? await api.save() : false;
            if (!ok) {
              showErrorToast("保存に失敗しました");
              return;
            }
            dismissDialog();
            openConfirm();
          },
          onDiscard: () => {
            dismissDialog();
            openConfirm();
          },
        });
        return;
      }
      openConfirm();
    },
    [
      resolveTargetPaneId,
      rootId,
      nodes,
      showUnsaved,
      showOpenConfirm,
      dismissDialog,
      openMarkdownInPane,
    ],
  );

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
    // 各 ShortcutId に対するアクション。registry のデフォルトキーまたは settings の
    // 上書きキーが押されたときにディスパッチされる。preventDefault / stopPropagation も
    // ハンドラ内で行う。各ハンドラは未充足条件で early return する（既存挙動の踏襲）。
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
        const meta = useTerminalMetaStore
          .getState()
          .metas.get(activeTerminalId);
        if (meta && meta.viewMode === "md" && meta.mdDirty && meta.mdFilePath) {
          const targetId = activeTerminalId;
          const filePath = meta.mdFilePath;
          showUnsaved({
            filePath,
            paneId: targetId,
            reason: "close-pane",
            onSave: async () => {
              const api = markdownEditorRegistry.getApi(targetId);
              const ok = api ? await api.save() : false;
              if (!ok) {
                showErrorToast("保存に失敗しました");
                return;
              }
              dismissDialog();
              closeTerminal(targetId);
            },
            onDiscard: () => {
              dismissDialog();
              closeTerminal(targetId);
            },
          });
          return;
        }
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
        // dev ビルドでは Electron のデフォルトで page reload になり得るため、
        // サイドバーの状態に関わらず常に preventDefault する。
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
        // 入力要素 (rename input 等) にフォーカスがあるときは
        // ブラウザのテキスト Undo を尊重する。xterm の helper textarea は除外。
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
      "font-zoom-in": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!activeTerminalId) return;
        adjustActivePaneFontSize(activeTerminalId, +1);
      },
      "font-zoom-out": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!activeTerminalId) return;
        adjustActivePaneFontSize(activeTerminalId, -1);
      },
      "font-zoom-reset": (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!activeTerminalId) return;
        useTerminalMetaStore
          .getState()
          .setFontSizeOverride(activeTerminalId, null);
      },
    };

    const handleKeyDown = (e: KeyboardEvent): void => {
      // IME 変換中は処理をスキップ
      if (e.isComposing || e.keyCode === 229) return;

      // ショートカット録音中はディスパッチを抑制し、SettingsModal 側の
      // 録音 listener にキー入力を委ねる。
      if (useSettingsModalStore.getState().recordingShortcutId !== null) return;

      // Cmd+Shift+ArrowLeft/Right/Up/Down: 行選択（Cmd+Shift+A の追加エイリアス）。
      // 4 つのキーが同じアクションに飛ぶ特殊ケースは registry に乗せず、
      // ここで先に処理する。registry には Cmd+Shift+A だけが登録されている。
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

      // ユーザー設定で上書きされた shortcut bindings を適用。未設定の ID は
      // resolveShortcutKey() の中でデフォルトキーにフォールバックする。
      const bindings = useSettingsStore.getState().settings.shortcuts;

      // input 等の編集可能要素にフォーカスがあり、テキスト編集系ショートカットが
      // マッチした場合は capture phase で横取りせずブラウザ標準動作を維持する。
      // (xterm の helper textarea は isEditableTarget で false 扱い)
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

    // キャプチャフェーズでイベントを処理し、xtermより先にショートカットを処理
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    activeTerminalId,
    splitTerminal,
    closeTerminal,
    canSplitNow,
    terminalCount,
    moveFocus,
    showUnsaved,
    dismissDialog,
  ]);

  // セッション永続化: レイアウト / CWD 変更を debounced に Main へ送る
  useEffect(() => {
    return startSessionPersist();
  }, []);

  // 起動時に settings をロードし、永続化された currentThemeId を themeStore に反映する。
  // 各ウィンドウは起動時の 1 回だけ反映し、以降は独立してテーマを切り替え可能にする。
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
      </div>
      <ErrorToastHost />
      {dialogRequest?.kind === "open-confirm" && (
        <OpenMarkdownModal
          isOpen
          filePath={dialogRequest.filePath}
          availablePanes={dialogRequest.availablePanes}
          defaultPaneId={dialogRequest.defaultPaneId}
          onConfirm={dialogRequest.onConfirm}
          onCancel={dismissDialog}
        />
      )}
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
