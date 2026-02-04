import React, { useEffect, useCallback, useMemo } from "react";
import Header from "./components/Header";
import SplitContainer from "./components/SplitContainer";
import {
  useActiveTerminalId,
  useTerminalCount,
  useCanSplit,
  useNodes,
  useTerminalActions,
} from "./stores/terminalStore";
import { theme } from "./styles/theme";
import { getAllTerminalIds } from "./utils/layoutUtils";
import * as terminalManager from "./services/terminalManager";

const App: React.FC = () => {
  const activeTerminalId = useActiveTerminalId();
  const terminalCount = useTerminalCount();
  const canSplit = useCanSplit();
  const nodes = useNodes();
  const { setActiveTerminal, splitTerminal, closeTerminal } =
    useTerminalActions();

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
      if (isMeta && !isShift && !isOption && e.key === "d") {
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
      if (isMeta && !isShift && !isOption && e.key === "w") {
        e.preventDefault();
        if (activeTerminalId && terminalCount > 1) {
          closeTerminal(activeTerminalId);
        }
        return;
      }

      // Cmd + Delete: 行全体を削除（Ctrl+E で行末へ、Ctrl+U で行頭まで削除）
      if (isMeta && !isShift && !isOption && e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          // 行末へ移動してから行頭まで削除
          window.api.pty.write(activeTerminalId, "\x05"); // Ctrl+E: 行末へ
          window.api.pty.write(activeTerminalId, "\x15"); // Ctrl+U: 行頭まで削除
        }
        return;
      }

      // Cmd + K: カーソルから行末まで削除
      if (isMeta && !isShift && !isOption && e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          window.api.pty.write(activeTerminalId, "\x0b"); // Ctrl+K
        }
        return;
      }
      // Cmd + Z: Undo（readline の Ctrl+_ を送信）
      if (isMeta && !isShift && !isOption && e.key === "z") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          // Ctrl+_ (0x1f) は readline の undo コマンド
          // zsh で動作しない場合: ~/.zshrc に `bindkey '^_' undo` を追加
          window.api.pty.write(activeTerminalId, "\x1f");
        }
        return;
      }

      // Cmd + Shift + Z: Redo（zsh の redo を送信）
      if (isMeta && isShift && !isOption && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          // Ctrl+^ (0x1e) を redo にマッピング
          // ~/.zshrc に `bindkey '^^' redo` を追加
          window.api.pty.write(activeTerminalId, "\x1e");
        }
        return;
      }

      // Cmd + ←: 行の先頭へ
      if (isMeta && !isShift && !isOption && e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          window.api.pty.write(activeTerminalId, "\x01"); // Ctrl+A
        }
        return;
      }

      // Cmd + →: 行の末尾へ
      if (isMeta && !isShift && !isOption && e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          window.api.pty.write(activeTerminalId, "\x05"); // Ctrl+E
        }
        return;
      }

      // Shift + Enter: 改行を挿入
      if (!isMeta && isShift && !isOption && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          window.api.pty.write(activeTerminalId, "\n");
        }
        return;
      }

      // Option + Delete: 単語を後方削除
      if (!isMeta && !isShift && isOption && e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          window.api.pty.write(activeTerminalId, "\x17"); // Ctrl+W
        }
        return;
      }

      // Option + ←: 単語単位で左へ移動（Cmd+Optionでない場合のみ）
      if (!isMeta && !isShift && isOption && e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          window.api.pty.write(activeTerminalId, "\x1bb"); // ESC+b
        }
        return;
      }

      // Option + →: 単語単位で右へ移動（Cmd+Optionでない場合のみ）
      if (!isMeta && !isShift && isOption && e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          window.api.pty.write(activeTerminalId, "\x1bf"); // ESC+f
        }
        return;
      }

      // Option + D: 単語を前方削除（カーソル以降）
      if (!isMeta && !isShift && isOption && e.key === "d") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTerminalId) {
          window.api.pty.write(activeTerminalId, "\x1bd"); // ESC+d
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
      <div style={{ flex: 1, overflow: "hidden" }}>
        <SplitContainer />
      </div>
    </div>
  );
};

export default App;
