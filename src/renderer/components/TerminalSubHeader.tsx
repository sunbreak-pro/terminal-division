import React, { useMemo } from "react";
import { useTerminalMeta } from "../stores/terminalMetaStore";
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";

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
      </div>
    );
  },
);

TerminalSubHeader.displayName = "TerminalSubHeader";

export { TerminalSubHeader };
