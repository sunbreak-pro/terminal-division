import React, { useCallback, useMemo } from "react";
import { useTerminalMeta } from "../stores/terminalMetaStore";
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";
import { promptAndInsertFiles } from "../utils/insertFiles";
import * as terminalManager from "../services/terminalManager";

interface TerminalSubHeaderProps {
  id: string;
  paneNumber: number;
}

// ホームディレクトリのキャッシュ（preloadのsystem.getHomeDirから取得）
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

    // フォルダ名のみ取得
    const folderName = useMemo(() => {
      if (displayCwd === "~") return "~";
      const parts = displayCwd.split("/");
      return parts[parts.length - 1] || displayCwd;
    }, [displayCwd]);

    // プロセス名表示: シェル名と同じ場合はシェル名のみ
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

    // スクロールバッファをクリア（プロンプト行は残す。シェル状態には触れない）
    const handleClearScrollback = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        terminalManager.clearScrollback(id);
      },
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

    // 共通アイコンボタンスタイル（挿入 / クリア）
    const iconButtonStyle = useMemo<React.CSSProperties>(
      () => ({
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "18px",
        height: "18px",
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
          height: "22px",
          minHeight: "22px",
          backgroundColor: theme.colors.headerBackground,
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          gap: "6px",
          fontSize: "11px",
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
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {paneNumber}
        </span>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 1,
            minWidth: 0,
          }}
          title={displayCwd}
        >
          {folderName}
        </span>
        <span style={{ color: theme.colors.border, flexShrink: 0 }}>|</span>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 1,
            minWidth: 0,
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
            title="スクロールバックをクリア（プロンプト行は保持）"
            aria-label="スクロールバックをクリア"
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
        </div>
      </div>
    );
  },
);

TerminalSubHeader.displayName = "TerminalSubHeader";

export { TerminalSubHeader };
