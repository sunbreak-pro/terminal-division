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
import { requestEditMarkdownFromSidebar } from "./services/markdownOpenService";
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
import {
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  EDITOR_FONT_SIZE_MAX,
  DEFAULT_SETTINGS,
  clampNumber,
} from "../shared/settings";

// アクティブペインの viewMode を返す。null = アクティブ無し or meta 不在。
// CLI / md の判定で Cmd+= / Cmd+- / Cmd+0 のターゲットを切り替える。
function resolveActiveViewMode(): "cli" | "md" | null {
  const activeId = useTerminalStore.getState().activeTerminalId;
  if (!activeId) return null;
  const meta = useTerminalMetaStore.getState().metas.get(activeId);
  return meta?.viewMode ?? null;
}

// Cmd+= / Cmd+- 共通: アクティブペインの viewMode に応じて
// terminal / editor いずれかの fontSize を delta だけ動かす。
// per-pane override ではなく Settings 自体を直接更新するので、Settings UI の
// スライダー値と表示が常に同期する。settingsStore.update が
// clearAllFontSizeOverrides も呼ぶので、過去の override は自動的に解除される。
function adjustGlobalFontSize(delta: number): void {
  const mode = resolveActiveViewMode();
  const settings = useSettingsStore.getState().settings;
  if (mode === "md") {
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
  // cli or null（アクティブ無し）はターミナル設定を更新する（既存挙動）
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

// Cmd+0: viewMode に応じてファクトリーデフォルトに戻す。
// 既存の terminal は 14（旧仕様の reset 値）を維持。editor は
// DEFAULT_SETTINGS の値を使う。
function resetGlobalFontSize(): void {
  const mode = resolveActiveViewMode();
  if (mode === "md") {
    useSettingsStore.getState().update({
      editor: { fontSize: DEFAULT_SETTINGS.editor.fontSize },
    });
    return;
  }
  useSettingsStore.getState().update({ terminal: { fontSize: 14 } });
  // 念のため override もクリア（settingsStore 側でクリアされるが、
  // 14 が現在値と同じだった場合 fontSize 変更判定に引っかからないため）
  useTerminalMetaStore.getState().clearAllFontSizeOverrides();
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
  // Shift+Enter: 通常の input/textarea では改行のデフォルト動作を維持する。
  // xterm の helper textarea は isEditableTarget で false 扱いなので、
  // CLI ターミナルでは引き続き writeWithHistory("\n") が走る。
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

  // Sidebar からの「編集する」要求 → 確認モーダル → 開く。
  // 詳細フローは markdownOpenService に集約。新規ペイン作成オプションを許可する。
  const handleRequestEditMarkdown = useCallback(
    (filePath: string): void => {
      if (!isMarkdownPath(filePath)) return; // 念のため
      const defaultPaneId = resolveTargetPaneId();
      if (!defaultPaneId) {
        showErrorToast("対象ペインが見つかりません");
        return;
      }
      requestEditMarkdownFromSidebar(filePath, defaultPaneId);
    },
    [resolveTargetPaneId],
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
        // dirty な MD タブが 1 つでもあれば、最初の dirty タブを対象に未保存警告を出す。
        // 複数 dirty 環境で全部の保存を強制するのは煩わしいので、ユーザー操作で順に
        // 保存してから最終的に close を再実行してもらう設計（discard なら問答無用で close）。
        const dirtyTab = meta?.mdTabs.find((t) => t.dirty);
        if (dirtyTab) {
          const targetPaneId = activeTerminalId;
          const targetTabId = dirtyTab.id;
          showUnsaved({
            filePath: dirtyTab.filePath,
            paneId: targetPaneId,
            tabId: targetTabId,
            reason: "close-pane",
            onSave: async () => {
              const api = markdownEditorRegistry.getApi(targetTabId);
              const ok = api ? await api.save() : false;
              if (!ok) {
                showErrorToast("保存に失敗しました");
                return;
              }
              dismissDialog();
              closeTerminal(targetPaneId);
            },
            onDiscard: () => {
              dismissDialog();
              closeTerminal(targetPaneId);
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
      // 理由: 日本語 IME 有効時、"-" キーは "ー" として消費されたり
      // e.keyCode === 229 を伴う合成イベントになることがあり、その場合
      // 後段の IME ガードに弾かれて Cmd+- が反応しない。Cmd 修飾ありは
      // アプリのコマンドであり IME 入力ではないので、ここで先取りする。
      if (e.metaKey && !e.ctrlKey && !e.altKey) {
        const earlyBindings = useSettingsStore.getState().settings.shortcuts;
        const zoomInKey = resolveShortcutKey("font-zoom-in", earlyBindings);
        const zoomOutKey = resolveShortcutKey("font-zoom-out", earlyBindings);
        const zoomResetKey = resolveShortcutKey(
          "font-zoom-reset",
          earlyBindings,
        );
        // 拡大: Plus の物理キー（US: Equal+Shift, JIS: Semicolon+Shift）または e.key="+"
        const isZoomIn =
          zoomInKey !== null &&
          (e.key === "+" ||
            (e.shiftKey && (e.code === "Equal" || e.code === "Semicolon")));
        // 縮小: Shift なしで Minus の物理キー or "-" 文字 or 旧 keyCode 189
        // 旧 keyCode 189 を含めることで IME / 配列違いで e.key/e.code が想定外でも拾う
        const isZoomOut =
          zoomOutKey !== null &&
          !e.shiftKey &&
          (e.key === "-" || e.code === "Minus" || e.keyCode === 189);
        // リセット: Shift なしで Digit0 物理キー or "0" 文字 or 旧 keyCode 48
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
    resolveTargetPaneId,
  ]);

  // 表示メニューからのフォントズーム IPC を購読する。
  // Chromium が Cmd+= / Cmd+- / Cmd+0 をブラウザプロセス層で消費するため、
  // renderer の keydown には届かない。メニューアクセラレータ + IPC 経由で
  // アクションをディスパッチする（main/menu.ts 参照）。
  // 仕様: グローバル Settings.terminal.fontSize を直接動かして、Settings UI の
  // スライダー値とターミナル表示を常に同期させる。
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

  // セッション永続化: レイアウト / CWD 変更を debounced に Main へ送る
  useEffect(() => {
    return startSessionPersist();
  }, []);

  // アプリ全体ズームを WebFrame に反映する。settings.general.appZoomFactor が
  // 変わるたびに preload 経由で webFrame.setZoomFactor を呼ぶ。
  // 起動直後は load() が完了する前 (DEFAULT 1.0) に走るが、その後 load 完了で
  // 永続化値で再呼出しされて正しい倍率に揃う。
  const appZoomFactor = useSettingsStore(
    (s) => s.settings.general.appZoomFactor,
  );
  useEffect(() => {
    window.api.window.setZoomFactor(appZoomFactor);
  }, [appZoomFactor]);

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
          allowCreateNewPane={dialogRequest.allowCreateNewPane}
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
