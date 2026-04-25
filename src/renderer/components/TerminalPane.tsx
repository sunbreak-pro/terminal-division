import React, { useEffect, useRef, useCallback, useMemo } from "react";
import "@xterm/xterm/css/xterm.css";
import {
  useActiveTerminalId,
  useTerminalActions,
} from "../stores/terminalStore";
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";
import * as terminalManager from "../services/terminalManager";
import { rafDebounceWithDelay } from "../utils/rafDebounce";
import { TerminalSubHeader } from "./TerminalSubHeader";
import { useTerminalMetaStore } from "../stores/terminalMetaStore";
import { formatPaths } from "../utils/insertFiles";

const TD_PATH_MIME = "application/x-td-path";

interface TerminalPaneProps {
  id: string;
  paneNumber: number;
}

const TerminalPane: React.FC<TerminalPaneProps> = React.memo(
  ({ id, paneNumber }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const activeTerminalId = useActiveTerminalId();
    const { setActiveTerminal, closeTerminal } = useTerminalActions();
    const isActive = activeTerminalId === id;

    const currentTheme = useCurrentTheme();
    const themeConfig = useThemeConfig();
    const theme = { colors: currentTheme.colors, ...themeConfig };
    const xtermTheme = currentTheme.xterm;

    // Focus terminal when it becomes active
    // ペインが非アクティブ→アクティブに切り替わった瞬間のみ最下部へスクロールする。
    // （既にアクティブな状態で useEffect が再実行されることはないので、
    //  ユーザーがスクロールして見ている途中に勝手にジャンプすることはない）
    useEffect(() => {
      if (isActive) {
        terminalManager.focus(id);
        terminalManager.scrollToBottom(id);
      }
    }, [isActive, id]);

    const handleFit = useCallback(() => {
      const result = terminalManager.fit(id);
      if (result) {
        window.api.pty.resize(id, result.cols, result.rows);
      }
    }, [id]);

    useEffect(() => {
      if (!containerRef.current) return;

      // 1. Get or create terminal instance (callbacks are registered ONCE during creation)
      const instance = terminalManager.getOrCreate(
        id,
        {
          theme: xtermTheme,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          fontSize: 13,
          lineHeight: 1.2,
          cursorBlink: true,
          cursorStyle: "block",
          allowTransparency: true,
          allowProposedApi: true,
          scrollback: 10000,
        },
        {
          onData: (data) => {
            window.api.pty.write(id, data);
          },
          onExit: () => {
            closeTerminal(id);
          },
          onFocus: () => {
            setActiveTerminal(id);
          },
        },
      );

      // 2. Attach to DOM container
      terminalManager.attachToContainer(id, containerRef.current);

      // 3. Set up PTY (only if not already created)
      if (!instance.ptyCreated) {
        // Mark as created IMMEDIATELY (before setTimeout) to prevent duplicate registration
        instance.ptyCreated = true;

        // Create PTY after DOM is ready
        setTimeout(() => {
          instance.fitAddon.fit();
          const { cols, rows } = instance.terminal;

          // CWD優先順位: メタストア（分割時設定） > windowInitialCwd（Dockメニュー） > undefined
          const initialCwd =
            useTerminalMetaStore.getState().metas.get(id)?.cwd ??
            window.api.window.getInitialCwd() ??
            undefined;

          window.api.pty
            .create(id, initialCwd)
            .then(() => {
              window.api.pty.resize(id, cols, rows);
            })
            .catch((error) => {
              console.error(`Failed to create PTY for terminal ${id}:`, error);
              instance.terminal.write(
                "\r\n\x1b[31mError: Failed to create terminal process\x1b[0m\r\n",
              );
            });
        }, 0);
      } else {
        // Terminal already exists, just fit it
        setTimeout(() => {
          handleFit();
        }, 0);
      }

      // 4. Set up ResizeObserver with rAF-based debounce
      // 50ms遅延 + requestAnimationFrameで滑らかなリサイズを実現
      const { handler: debouncedFit, cancel: cancelFit } = rafDebounceWithDelay(
        handleFit,
        50,
      );
      const resizeObserver = new ResizeObserver(() => {
        debouncedFit();
      });
      resizeObserver.observe(containerRef.current);

      // Cleanup: only disconnect observer, do NOT dispose terminal or kill PTY
      return () => {
        cancelFit();
        resizeObserver.disconnect();
      };
    }, [id, closeTerminal]);

    const handleMouseDown = useCallback((): void => {
      setActiveTerminal(id);
    }, [id, setActiveTerminal]);

    // ===== D&D: ツリーや外部からファイルをドロップしてパスを挿入 =====
    const handleDragOver = useCallback((e: React.DragEvent): void => {
      // パス含む drag のみ受け入れる
      const types = e.dataTransfer.types;
      if (
        types.includes(TD_PATH_MIME) ||
        types.includes("Files") ||
        types.includes("text/plain")
      ) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    }, []);

    const handleDrop = useCallback(
      (e: React.DragEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        setActiveTerminal(id);

        // 1) ツリー内 D&D: 独自 MIME から path を取得
        const internal = e.dataTransfer.getData(TD_PATH_MIME);
        if (internal) {
          window.api.pty.write(id, formatPaths([internal]));
          return;
        }
        // 2) 外部 (Finder 等) からのファイル: webUtils 経由でパスを取得
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
          const paths = files
            .map((f) => window.api.fs.getPathForFile(f))
            .filter((p) => p && p.length > 0);
          if (paths.length > 0) {
            window.api.pty.write(id, formatPaths(paths));
            return;
          }
        }
        // 3) 最終手段: text/plain から取得
        const text = e.dataTransfer.getData("text/plain");
        if (text) {
          window.api.pty.write(id, formatPaths([text]));
        }
      },
      [id, setActiveTerminal],
    );

    // Memoize container style
    const containerStyle = useMemo(
      () => ({
        height: "100%",
        width: "100%",
        padding: "3px",
        borderColor: theme.colors.border,
        borderRadius: theme.borderRadius,
        position: "relative" as const,
        boxSizing: "border-box" as const,
        border: isActive
          ? `3px solid ${theme.colors.activeTerminal}`
          : `2px solid ${theme.colors.border}`,
      }),
      [
        isActive,
        theme.colors.border,
        theme.colors.activeTerminal,
        theme.borderRadius,
      ],
    );

    return (
      <div
        className="terminal-container"
        onMouseDown={handleMouseDown}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={containerStyle}
      >
        <TerminalSubHeader id={id} paneNumber={paneNumber} />
        <div
          ref={containerRef}
          style={{
            height: "calc(100% - 22px)",
            width: "100%",
          }}
        />
      </div>
    );
  },
);

TerminalPane.displayName = "TerminalPane";

export default TerminalPane;
