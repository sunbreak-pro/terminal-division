import React, { useEffect, useCallback, useMemo } from "react";
import Header from "./components/Header";
import SplitContainer from "./components/SplitContainer";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { ErrorToastHost } from "./components/Sidebar/ErrorToast";
import {
  useActiveTerminalId,
  useTerminalCount,
  useCanSplit,
  useNodes,
  useTerminalActions,
} from "./stores/terminalStore";
import {
  useCurrentTheme,
  useThemeConfig,
  setupThemeSync,
} from "./stores/themeStore";
import { getAllTerminalIds } from "./utils/layoutUtils";
import { promptAndInsertFiles } from "./utils/insertFiles";
import * as terminalManager from "./services/terminalManager";
import { useTerminalSearchStore } from "./stores/terminalSearchStore";
import { useFileTreeStore } from "./stores/fileTreeStore";
import { useSidebarStore } from "./stores/sidebarStore";
import { useFileOpsHistoryStore } from "./stores/fileOpsHistoryStore";
import { undoLast, redoLast } from "./services/fileOpsService";
import { startSessionPersist } from "./services/sessionPersist";

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

const App: React.FC = () => {
  const activeTerminalId = useActiveTerminalId();
  const terminalCount = useTerminalCount();
  const canSplit = useCanSplit();
  const nodes = useNodes();
  const { setActiveTerminal, splitTerminal, closeTerminal } =
    useTerminalActions();

  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  const canSplitNow = canSplit();

  const terminalIds = useMemo(() => getAllTerminalIds(nodes), [nodes]);

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
    const handleKeyDown = (e: KeyboardEvent): void => {
      // IME変換中は処理をスキップ
      if (e.isComposing || e.keyCode === 229) {
        return;
      }

      const isMeta = e.metaKey;
      const isShift = e.shiftKey;
      const isOption = e.altKey;

      // Cmd + D: 縦に分割 (horizontal direction = left/right split)
      if (isMeta && !isShift && !isOption && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (activeTerminalId && canSplitNow) {
          splitTerminal(activeTerminalId, "horizontal");
        }
        return;
      }

      // Cmd + Shift + D: 横に分割 (vertical direction = top/bottom split)
      if (isMeta && isShift && !isOption && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (activeTerminalId && canSplitNow) {
          splitTerminal(activeTerminalId, "vertical");
        }
        return;
      }

      // Cmd + Shift + 矢印: 行選択
      if (isMeta && isShift && !isOption) {
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

      // Cmd + Shift + A: 現在行を選択
      if (isMeta && isShift && !isOption && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          terminalManager.selectCurrentLine(activeTerminalId);
        }
        return;
      }

      // Cmd + W: 閉じる
      if (isMeta && !isShift && !isOption && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (activeTerminalId && terminalCount > 1) {
          closeTerminal(activeTerminalId);
        }
        return;
      }

      // Cmd + F: 検索オーバーレイを開く（ペインごと）
      if (isMeta && !isShift && !isOption && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          useTerminalSearchStore.getState().toggle(activeTerminalId);
        }
        return;
      }

      // Cmd + R: サイドバーのディレクトリツリーを再読み込み
      // dev ビルドでは Electron のデフォルトで page reload になり得るため、
      // サイドバーの状態に関わらず常に preventDefault する。
      if (isMeta && !isShift && !isOption && e.key.toLowerCase() === "r") {
        e.preventDefault();
        e.stopPropagation();
        const { isOpen, selectedTabCwd } = useSidebarStore.getState();
        if (isOpen && selectedTabCwd) {
          void useFileTreeStore.getState().refreshAllExpanded(selectedTabCwd);
        }
        return;
      }

      // Cmd + O: ファイルを選択してパスを挿入
      if (isMeta && !isShift && !isOption && e.key.toLowerCase() === "o") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          void promptAndInsertFiles(activeTerminalId);
        }
        return;
      }

      // Cmd + Z: Undo（サイドバー操作 or ターミナル行入力）
      if (isMeta && !isShift && !isOption && e.key.toLowerCase() === "z") {
        // 入力要素 (rename input 等) にフォーカスがあるときは
        // ブラウザのテキスト Undo を尊重する。xterm の helper textarea は除外。
        const target = e.target as HTMLElement | null;
        if (isEditableTarget(target)) {
          return;
        }
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
        return;
      }

      // Cmd + Shift + Z: Redo（サイドバー or ターミナル）
      if (isMeta && isShift && !isOption && e.key.toLowerCase() === "z") {
        const target = e.target as HTMLElement | null;
        if (isEditableTarget(target)) {
          return;
        }
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
        return;
      }

      // Cmd + . : サイドバーの開閉トグル
      if (isMeta && !isShift && !isOption && e.key === ".") {
        e.preventDefault();
        e.stopPropagation();
        useSidebarStore.getState().toggleOpen();
        return;
      }

      // Cmd + Delete: カーソル位置から行頭まで削除
      if (isMeta && !isShift && !isOption && e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          terminalManager.writeWithHistory(activeTerminalId, "\x15"); // Ctrl+U: backward-kill-line
        }
        return;
      }

      // Cmd + K: カーソルから行末まで削除
      if (isMeta && !isShift && !isOption && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          terminalManager.writeWithHistory(activeTerminalId, "\x0b"); // Ctrl+K
        }
        return;
      }
      // Cmd + ←: 行の先頭へ
      if (isMeta && !isShift && !isOption && e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        if (
          activeTerminalId &&
          terminalManager.isShellReady(activeTerminalId)
        ) {
          window.api.pty.write(activeTerminalId, "\x01"); // Ctrl+A
        }
        return;
      }

      // Cmd + →: 行の末尾へ
      if (isMeta && !isShift && !isOption && e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        if (
          activeTerminalId &&
          terminalManager.isShellReady(activeTerminalId)
        ) {
          window.api.pty.write(activeTerminalId, "\x05"); // Ctrl+E
        }
        return;
      }

      // Shift + Enter: 改行を挿入
      if (!isMeta && isShift && !isOption && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          terminalManager.writeWithHistory(activeTerminalId, "\n");
        }
        return;
      }

      // Option + Delete: 単語を後方削除
      if (!isMeta && !isShift && isOption && e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          terminalManager.writeWithHistory(activeTerminalId, "\x17"); // Ctrl+W
        }
        return;
      }

      // Option + ←: 単語単位で左へ移動（Cmd+Optionでない場合のみ）
      if (!isMeta && !isShift && isOption && e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        if (
          activeTerminalId &&
          terminalManager.isShellReady(activeTerminalId)
        ) {
          window.api.pty.write(activeTerminalId, "\x1bb"); // ESC+b
        }
        return;
      }

      // Option + →: 単語単位で右へ移動（Cmd+Optionでない場合のみ）
      if (!isMeta && !isShift && isOption && e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        if (
          activeTerminalId &&
          terminalManager.isShellReady(activeTerminalId)
        ) {
          window.api.pty.write(activeTerminalId, "\x1bf"); // ESC+f
        }
        return;
      }

      // Option + D: 単語を前方削除（カーソル以降）
      if (!isMeta && !isShift && isOption && e.key.toLowerCase() === "d") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          terminalManager.writeWithHistory(activeTerminalId, "\x1bd"); // ESC+d
        }
        return;
      }

      // Cmd + Option + Arrow: フォーカス移動
      if (isMeta && isOption && !isShift) {
        switch (e.key) {
          case "ArrowUp":
            e.preventDefault();
            moveFocus("up");
            break;
          case "ArrowDown":
            e.preventDefault();
            moveFocus("down");
            break;
          case "ArrowLeft":
            e.preventDefault();
            moveFocus("left");
            break;
          case "ArrowRight":
            e.preventDefault();
            moveFocus("right");
            break;
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
  ]);

  // 他のウィンドウからのテーマ同期を受信
  useEffect(() => {
    return setupThemeSync();
  }, []);

  // セッション永続化: レイアウト / CWD 変更を debounced に Main へ送る
  useEffect(() => {
    return startSessionPersist();
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
        <Sidebar />
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <SplitContainer />
        </div>
      </div>
      <ErrorToastHost />
    </div>
  );
};

export default App;
