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
    useEffect(() => {
      if (isActive) {
        terminalManager.focus(id);
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

          // セッション復元時のCWDをメタストアから取得
          const initialCwd =
            useTerminalMetaStore.getState().metas.get(id)?.cwd ?? undefined;

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
        terminalManager.detachFromContainer(id);
      };
    }, [id, closeTerminal]);

    const handleClick = useCallback((): void => {
      setActiveTerminal(id);
      terminalManager.focus(id);
    }, [id, setActiveTerminal]);

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
        onClick={handleClick}
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
