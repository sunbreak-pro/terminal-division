import React, { useCallback, useMemo, useEffect } from "react";
import {
  useActiveTerminalId,
  useCanSplit,
  useTerminalActions,
} from "../stores/terminalStore";
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";
import * as terminalManager from "../services/terminalManager";
import { useSidebarStore, useSidebarOpen } from "../stores/sidebarStore";
import {
  useRightSidebarStore,
  useRightSidebarOpen,
} from "../stores/rightSidebarStore";
import { useSettingsModalStore } from "../stores/settingsModalStore";
import { PanelLeftIcon, PanelRightIcon } from "./Sidebar/icons";

const Header: React.FC = React.memo(() => {
  const activeTerminalId = useActiveTerminalId();
  const canSplit = useCanSplit();
  const { splitTerminal } = useTerminalActions();
  const sidebarOpen = useSidebarOpen();
  const toggleSidebar = useSidebarStore((s) => s.toggleOpen);
  const rightSidebarOpen = useRightSidebarOpen();
  const toggleRightSidebar = useRightSidebarStore((s) => s.toggleOpen);

  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  // テーマ変更時に全ターミナルを更新
  useEffect(() => {
    terminalManager.updateAllThemes(currentTheme.xterm);
  }, [currentTheme]);

  const canSplitNow = canSplit();

  const handleSplitVertical = useCallback((): void => {
    if (activeTerminalId && canSplitNow) {
      splitTerminal(activeTerminalId, "horizontal");
    }
  }, [activeTerminalId, canSplitNow, splitTerminal]);

  const handleSplitHorizontal = useCallback((): void => {
    if (activeTerminalId && canSplitNow) {
      splitTerminal(activeTerminalId, "vertical");
    }
  }, [activeTerminalId, canSplitNow, splitTerminal]);

  const handleChangeDirectory = useCallback(async (): Promise<void> => {
    if (!activeTerminalId) return;

    try {
      const selectedPath = await window.api.dialog.selectDirectory();
      if (selectedPath) {
        const escapedPath = selectedPath.replace(/'/g, "'\\''");
        window.api.pty.write(activeTerminalId, `cd '${escapedPath}'\n`);
      }
    } catch (error) {
      console.error("Failed to change directory:", error);
    }
  }, [activeTerminalId]);

  const buttonStyle = useMemo<React.CSSProperties>(
    () => ({
      padding: `${theme.spacing.xs} ${theme.spacing.md}`,
      backgroundColor: "transparent",
      color: theme.colors.text,
      border: `1px solid ${theme.colors.border}`,
      borderRadius: theme.borderRadius,
      cursor: "pointer",
      fontSize: "12px",
      display: "flex",
      alignItems: "center",
      gap: theme.spacing.xs,
      transition: "background-color 0.15s ease",
    }),
    [
      theme.spacing.xs,
      theme.spacing.md,
      theme.colors.text,
      theme.colors.border,
      theme.borderRadius,
    ],
  );

  const disabledStyle = useMemo<React.CSSProperties>(
    () => ({
      ...buttonStyle,
      opacity: 0.5,
      cursor: "not-allowed",
    }),
    [buttonStyle],
  );

  const handleSplitButtonEnter = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (canSplitNow) {
        e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
      }
    },
    [canSplitNow, theme.colors.buttonHover],
  );

  const handleButtonLeave = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.backgroundColor = "transparent";
    },
    [],
  );

  const handleDirectoryButtonEnter = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (activeTerminalId) {
        e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
      }
    },
    [activeTerminalId, theme.colors.buttonHover],
  );

  const handleOpenSettings = useCallback(() => {
    useSettingsModalStore.getState().open();
  }, []);

  const handleSettingsButtonEnter = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
    },
    [theme.colors.buttonHover],
  );

  return (
    <header
      className="titlebar-drag-region"
      style={{
        height: theme.headerHeight,
        backgroundColor: theme.colors.headerBackground,
        borderBottom: `1px solid ${theme.colors.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `0 ${theme.spacing.lg}`,
        paddingLeft: "80px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: theme.spacing.sm,
        }}
      >
        <div
          style={{
            color: theme.colors.textSecondary,
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          Terminal Division
        </div>
        <button
          type="button"
          className="titlebar-no-drag"
          onClick={toggleSidebar}
          title={sidebarOpen ? "サイドバーを閉じる" : "サイドバーを開く"}
          aria-pressed={sidebarOpen}
          style={{
            ...buttonStyle,
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
            color: sidebarOpen ? theme.colors.text : theme.colors.textSecondary,
            border: sidebarOpen
              ? `1px solid ${theme.colors.borderActive}`
              : `1px solid ${theme.colors.border}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <PanelLeftIcon size={14} />
        </button>
      </div>

      <div
        className="titlebar-no-drag"
        style={{
          display: "flex",
          gap: theme.spacing.sm,
        }}
      >
        <button
          onClick={handleSplitVertical}
          disabled={!canSplitNow}
          style={canSplitNow ? buttonStyle : disabledStyle}
          title="縦に分割 (Cmd+D)"
          onMouseEnter={handleSplitButtonEnter}
          onMouseLeave={handleButtonLeave}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="12" y1="3" x2="12" y2="21" />
          </svg>
          縦分割
        </button>

        <button
          onClick={handleSplitHorizontal}
          disabled={!canSplitNow}
          style={canSplitNow ? buttonStyle : disabledStyle}
          title="横に分割 (Cmd+Shift+D)"
          onMouseEnter={handleSplitButtonEnter}
          onMouseLeave={handleButtonLeave}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="12" x2="21" y2="12" />
          </svg>
          横分割
        </button>

        <button
          onClick={handleChangeDirectory}
          disabled={!activeTerminalId}
          style={activeTerminalId ? buttonStyle : disabledStyle}
          title="ディレクトリを移動"
          onMouseEnter={handleDirectoryButtonEnter}
          onMouseLeave={handleButtonLeave}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <polyline points="12 11 12 17" />
            <polyline points="9 14 12 11 15 14" />
          </svg>
          ディレクトリ移動
        </button>

        <button
          type="button"
          className="titlebar-no-drag"
          onClick={toggleRightSidebar}
          title={
            rightSidebarOpen
              ? "Markdown サイドバーを閉じる"
              : "Markdown サイドバーを開く"
          }
          aria-pressed={rightSidebarOpen}
          style={{
            ...buttonStyle,
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
            color: rightSidebarOpen
              ? theme.colors.text
              : theme.colors.textSecondary,
            border: rightSidebarOpen
              ? `1px solid ${theme.colors.borderActive}`
              : `1px solid ${theme.colors.border}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <PanelRightIcon size={14} />
        </button>

        <button
          onClick={handleOpenSettings}
          style={buttonStyle}
          title="設定 (Cmd+,)"
          onMouseEnter={handleSettingsButtonEnter}
          onMouseLeave={handleButtonLeave}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          設定
        </button>
      </div>
    </header>
  );
});

Header.displayName = "Header";

export default Header;
