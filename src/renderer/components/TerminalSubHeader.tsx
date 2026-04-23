import React, { useCallback, useMemo } from "react";
import { useTerminalMeta } from "../stores/terminalMetaStore";
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";
import { promptAndInsertFiles } from "../utils/insertFiles";

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

    const handleInsertButtonEnter = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
        e.currentTarget.style.color = theme.colors.text;
      },
      [theme.colors.buttonHover, theme.colors.text],
    );

    const handleInsertButtonLeave = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = theme.colors.textSecondary;
      },
      [theme.colors.textSecondary],
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
        <button
          type="button"
          onClick={handleInsertFile}
          onMouseEnter={handleInsertButtonEnter}
          onMouseLeave={handleInsertButtonLeave}
          title="ファイルを挿入 (Cmd+O)"
          aria-label="ファイルを挿入"
          style={{
            marginLeft: "auto",
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
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    );
  },
);

TerminalSubHeader.displayName = "TerminalSubHeader";

export { TerminalSubHeader };
