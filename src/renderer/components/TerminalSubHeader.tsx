import React, { useCallback, useMemo, useState } from "react";
import {
  useTerminalMeta,
  useTerminalMetaStore,
} from "../stores/terminalMetaStore";
import { useTerminalActions, useTerminalCount } from "../stores/terminalStore";
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";
import { useTerminalSettings } from "../stores/settingsStore";
import { promptAndInsertFiles } from "../utils/insertFiles";
import * as terminalManager from "../services/terminalManager";
import { ContextMenu, ContextMenuItem } from "./Sidebar/ContextMenu";

interface TerminalSubHeaderProps {
  id: string;
  paneNumber: number;
}

// ホームディレクトリのキャッシュ
let cachedHomeDir: string | null = null;
function getHomeDir(): string {
  if (cachedHomeDir === null) {
    cachedHomeDir = window.api.system.getHomeDir();
  }
  return cachedHomeDir;
}

const TerminalSubHeader: React.FC<TerminalSubHeaderProps> = React.memo(
  ({ id, paneNumber }) => {
    const meta = useTerminalMeta(id);
    const currentTheme = useCurrentTheme();
    const themeConfig = useThemeConfig();
    const theme = { colors: currentTheme.colors, ...themeConfig };
    const terminalSettings = useTerminalSettings();
    const paneNumberFontSize =
      meta?.fontSizeOverride ?? terminalSettings.fontSize;

    // CWD表示: ホームディレクトリは ~ に変換、未報告時は ~ をデフォルト表示
    const displayCwd = useMemo(() => {
      if (!meta?.cwd) return "~";
      const home = getHomeDir();
      if (home && meta.cwd === home) return "~";
      if (home && meta.cwd.startsWith(home + "/")) {
        return "~/" + meta.cwd.slice(home.length + 1);
      }
      return meta.cwd;
    }, [meta?.cwd]);

    const folderName = useMemo(() => {
      if (displayCwd === "~") return "~";
      const parts = displayCwd.split("/");
      return parts[parts.length - 1] || displayCwd;
    }, [displayCwd]);

    // ペインタイトル inline rename
    const customTitle = meta?.customTitle ?? null;
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameDraft, setRenameDraft] = useState("");
    const startRename = useCallback(() => {
      setRenameDraft(customTitle ?? folderName);
      setIsRenaming(true);
    }, [customTitle, folderName]);
    const commitRename = useCallback(() => {
      const trimmed = renameDraft.trim();
      useTerminalMetaStore
        .getState()
        .setCustomTitle(id, trimmed.length === 0 ? null : trimmed);
      setIsRenaming(false);
    }, [id, renameDraft]);
    const cancelRename = useCallback(() => {
      setIsRenaming(false);
    }, []);

    // プロセス名表示
    const processDisplay = useMemo(() => {
      const shell = meta?.shellName || "shell";
      const process = meta?.processName;
      if (!process || process === shell) return shell;
      return `${shell}: ${process}`;
    }, [meta?.shellName, meta?.processName]);

    const handleInsertFile = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        void promptAndInsertFiles(id);
      },
      [id],
    );

    const { closeTerminal } = useTerminalActions();
    const terminalCount = useTerminalCount();
    const canClosePane = terminalCount > 1;
    const handleClosePane = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>): void => {
        e.stopPropagation();
        if (!canClosePane) return;
        closeTerminal(id);
      },
      [canClosePane, id, closeTerminal],
    );

    const handleCloseButtonEnter = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        if (canClosePane) {
          e.currentTarget.style.backgroundColor = theme.colors.danger;
          e.currentTarget.style.color = "#fff";
        }
      },
      [canClosePane, theme.colors.danger],
    );

    const handleCloseButtonLeave = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = theme.colors.textSecondary;
      },
      [theme.colors.textSecondary],
    );

    // スクロールバック削除メニュー
    const [clearMenuPos, setClearMenuPos] = useState<{
      x: number;
      y: number;
    } | null>(null);

    const handleClearScrollback = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (clearMenuPos !== null) {
          setClearMenuPos(null);
          return;
        }
        const rect = e.currentTarget.getBoundingClientRect();
        setClearMenuPos({ x: rect.left, y: rect.bottom + 4 });
      },
      [clearMenuPos],
    );

    const closeClearMenu = useCallback(() => setClearMenuPos(null), []);

    const clearMenuItems = useMemo<ContextMenuItem[]>(
      () => [
        {
          label: "すべてクリア（プロンプト行は保持）",
          onClick: () => terminalManager.clearScrollback(id),
        },
        {
          label: "直近 100 行を残す",
          onClick: () => terminalManager.trimScrollback(id, 100),
        },
        {
          label: "直近 500 行を残す",
          onClick: () => terminalManager.trimScrollback(id, 500),
        },
        {
          label: "直近 1000 行を残す",
          onClick: () => terminalManager.trimScrollback(id, 1000),
        },
        {
          label: "完全リセット",
          onClick: () => terminalManager.resetTerminal(id),
          danger: true,
          separatorBefore: true,
        },
      ],
      [id],
    );

    const handleIconButtonEnter = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
        e.currentTarget.style.color = theme.colors.text;
      },
      [theme.colors.buttonHover, theme.colors.text],
    );

    const handleIconButtonLeave = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = theme.colors.textSecondary;
      },
      [theme.colors.textSecondary],
    );

    const iconButtonStyle = useMemo<React.CSSProperties>(
      () => ({
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "20px",
        height: "20px",
        padding: 0,
        backgroundColor: "transparent",
        color: theme.colors.textSecondary,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: "4px",
        cursor: "pointer",
        fontSize: "14px",
        lineHeight: 1,
        transition: "background-color 0.15s ease, color 0.15s ease",
      }),
      [theme.colors.textSecondary, theme.colors.border],
    );

    return (
      <div
        style={{
          height: "28px",
          minHeight: "28px",
          backgroundColor: theme.colors.headerBackground,
          display: "flex",
          alignItems: "center",
          padding: "0 10px",
          gap: "8px",
          fontSize: "12px",
          fontFamily:
            '"SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontWeight: 500,
          letterSpacing: "0.02em",
          color: theme.colors.textSecondary,
          userSelect: "none",
          overflow: "hidden",
          whiteSpace: "nowrap",
          borderBottom: `1px solid ${theme.colors.border}`,
        }}
      >
        <span
          style={{
            color: theme.colors.accent,
            fontSize: `${paneNumberFontSize}px`,
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {paneNumber}
        </span>
        {isRenaming ? (
          <input
            type="text"
            value={renameDraft}
            autoFocus
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
              e.stopPropagation();
            }}
            placeholder={folderName}
            style={{
              flexShrink: 1,
              minWidth: 0,
              maxWidth: 240,
              padding: "0 4px",
              background: "transparent",
              border: `1px solid ${theme.colors.border}`,
              borderRadius: 3,
              color: theme.colors.text,
              fontSize: 12,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        ) : (
          <span
            onDoubleClick={startRename}
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              flexShrink: 1,
              minWidth: 0,
              color: theme.colors.text,
              fontWeight: 600,
              cursor: "text",
            }}
            title={
              customTitle
                ? `${customTitle}（ダブルクリックで編集 / 元: ${displayCwd}）`
                : `${displayCwd}（ダブルクリックで rename）`
            }
          >
            {customTitle ?? folderName}
          </span>
        )}
        <span style={{ color: theme.colors.border, flexShrink: 0 }}>|</span>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 1,
            minWidth: 0,
            fontWeight: 500,
          }}
        >
          {processDisplay}
        </span>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={handleClearScrollback}
            onMouseEnter={handleIconButtonEnter}
            onMouseLeave={handleIconButtonLeave}
            title="スクロールバックを削除（クリックでオプション表示）"
            aria-label="スクロールバックを削除"
            aria-haspopup="menu"
            aria-expanded={clearMenuPos !== null}
            style={iconButtonStyle}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleInsertFile}
            onMouseEnter={handleIconButtonEnter}
            onMouseLeave={handleIconButtonLeave}
            title="ファイルを挿入 (Cmd+O)"
            aria-label="ファイルを挿入"
            style={iconButtonStyle}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleClosePane}
            onMouseEnter={handleCloseButtonEnter}
            onMouseLeave={handleCloseButtonLeave}
            disabled={!canClosePane}
            title={
              canClosePane
                ? "このペインを閉じる (Cmd+W)"
                : "最後のペインは閉じられません"
            }
            aria-label="ペインを閉じる"
            style={{
              ...iconButtonStyle,
              borderColor: canClosePane
                ? theme.colors.danger
                : theme.colors.border,
              opacity: canClosePane ? 1 : 0.4,
              cursor: canClosePane ? "pointer" : "not-allowed",
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
        {clearMenuPos && (
          <ContextMenu
            x={clearMenuPos.x}
            y={clearMenuPos.y}
            items={clearMenuItems}
            onClose={closeClearMenu}
          />
        )}
      </div>
    );
  },
);

TerminalSubHeader.displayName = "TerminalSubHeader";

export { TerminalSubHeader };
