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
  useRightSidebarFullscreen,
} from "../stores/rightSidebarStore";
import { PanelLeftIcon, PanelRightIcon } from "./Sidebar/icons";

const Header: React.FC = React.memo(() => {
  const activeTerminalId = useActiveTerminalId();
  const canSplit = useCanSplit();
  const { splitTerminal } = useTerminalActions();
  const sidebarOpen = useSidebarOpen();
  const toggleSidebar = useSidebarStore((s) => s.toggleOpen);
  const rightSidebarOpen = useRightSidebarOpen();
  const rightSidebarFullscreen = useRightSidebarFullscreen();
  const toggleRightSidebar = useRightSidebarStore((s) => s.toggleOpen);
  const toggleRightSidebarFullscreen = useRightSidebarStore(
    (s) => s.toggleFullscreen,
  );
  // 検索フィールドは sidebarStore.searchQuery を直接購読するので、
  // DirectoryTree 側のフィルタと自動的に同期する（Header / Sidebar 双方向）
  const searchQuery = useSidebarStore((s) => s.searchQuery);
  const setSearchQuery = useSidebarStore((s) => s.setSearchQuery);

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

  // 中央検索フィールドのスタイル。Header の中央セクション内で flex:1 で広がり、
  // 上限幅 420px に収めることで Header の左右コントロールと干渉しない。
  const searchInputStyle = useMemo<React.CSSProperties>(
    () => ({
      width: "100%",
      maxWidth: 420,
      backgroundColor: theme.colors.background,
      color: theme.colors.text,
      border: `1px solid ${theme.colors.border}`,
      borderRadius: theme.borderRadius,
      padding: "5px 10px",
      fontSize: 12,
      fontFamily: "inherit",
      outline: "none",
      boxSizing: "border-box",
    }),
    [
      theme.colors.background,
      theme.colors.text,
      theme.colors.border,
      theme.borderRadius,
    ],
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

      {/* 中央: ファイル名検索フィールド。サイドバーが閉じていても表示する仕様 */}
      {/* （ユーザー要望: 常に Header 中央に置く）。値は sidebarStore に保持され、 */}
      {/* DirectoryTree が同じ値を購読してフィルタする */}
      <div
        className="titlebar-no-drag"
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minWidth: 0,
          padding: `0 ${theme.spacing.md}`,
        }}
      >
        <input
          id="header-file-search"
          data-file-search-input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ファイル名で検索"
          aria-label="ファイル名で検索"
          spellCheck={false}
          style={searchInputStyle}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = theme.colors.borderActive;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = theme.colors.border;
          }}
        />
      </div>

      <div
        className="titlebar-no-drag"
        style={{
          display: "flex",
          gap: theme.spacing.sm,
        }}
      >
        {/* アイコンのみのボタンは padding を sm に詰めて視覚的なバランスを取る */}
        <button
          onClick={handleSplitVertical}
          disabled={!canSplitNow}
          style={{
            ...(canSplitNow ? buttonStyle : disabledStyle),
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
          }}
          title="縦に分割 (Cmd+D)"
          aria-label="縦に分割"
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
        </button>

        <button
          onClick={handleSplitHorizontal}
          disabled={!canSplitNow}
          style={{
            ...(canSplitNow ? buttonStyle : disabledStyle),
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
          }}
          title="横に分割 (Cmd+Shift+D)"
          aria-label="横に分割"
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
        </button>

        <button
          onClick={handleChangeDirectory}
          disabled={!activeTerminalId}
          style={{
            ...(activeTerminalId ? buttonStyle : disabledStyle),
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
          }}
          title="ディレクトリを移動"
          aria-label="ディレクトリを移動"
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
          type="button"
          className="titlebar-no-drag"
          onClick={toggleRightSidebarFullscreen}
          title={
            rightSidebarFullscreen
              ? "Markdown サイドバーを通常表示に戻す"
              : "Markdown サイドバーを全画面表示にする"
          }
          aria-pressed={rightSidebarFullscreen}
          aria-label="Markdown サイドバー全画面表示"
          style={{
            ...buttonStyle,
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
            color: rightSidebarFullscreen
              ? theme.colors.text
              : theme.colors.textSecondary,
            border: rightSidebarFullscreen
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
          {rightSidebarFullscreen ? (
            // 全画面 ON: 縮小アイコン
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
              <path d="M9 21H5a2 2 0 0 1-2-2v-4" />
              <path d="M15 3h4a2 2 0 0 1 2 2v4" />
              <path d="M21 15v4a2 2 0 0 1-2 2h-4" />
              <path d="M3 9V5a2 2 0 0 1 2-2h4" />
            </svg>
          ) : (
            // 全画面 OFF: 拡大アイコン
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
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
});

Header.displayName = "Header";

export default Header;
