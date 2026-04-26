import React, { useCallback, useMemo } from "react";
import {
  useTerminalMeta,
  useTerminalMetaStore,
} from "../stores/terminalMetaStore";
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";
import { promptAndInsertFiles } from "../utils/insertFiles";
import * as terminalManager from "../services/terminalManager";
import * as markdownEditorRegistry from "../services/markdownEditorRegistry";
import { useMarkdownDialogStore } from "../stores/markdownDialogStore";
import { getFileName } from "../utils/markdownFile";
import { showErrorToast } from "./Sidebar/ErrorToast";

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

    // ===== Markdown タブ操作 =====
    const hasMarkdown = !!meta?.mdFilePath;
    const isMd = meta?.viewMode === "md";
    const isDirty = meta?.mdDirty ?? false;
    const mdFilePath = meta?.mdFilePath ?? null;

    const switchToMode = useCallback(
      (mode: "cli" | "md"): void => {
        if (meta?.viewMode === mode) return;
        useTerminalMetaStore.getState().setViewMode(id, mode);
      },
      [id, meta?.viewMode],
    );

    const handleClickCliTab = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (!isMd) return; // 既に CLI
        if (isDirty && mdFilePath) {
          // dirty な MD タブから CLI へ切替: 表示を隠すだけだが念のため警告
          useMarkdownDialogStore.getState().showUnsaved({
            filePath: mdFilePath,
            paneId: id,
            reason: "switch-to-cli",
            onSave: async () => {
              const api = markdownEditorRegistry.getApi(id);
              const ok = api ? await api.save() : false;
              if (!ok) {
                showErrorToast("保存に失敗しました");
                return;
              }
              useMarkdownDialogStore.getState().dismiss();
              switchToMode("cli");
            },
            onDiscard: () => {
              useMarkdownDialogStore.getState().dismiss();
              switchToMode("cli");
            },
          });
          return;
        }
        switchToMode("cli");
      },
      [id, isMd, isDirty, mdFilePath, switchToMode],
    );

    const handleClickMdTab = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        switchToMode("md");
      },
      [switchToMode],
    );

    // span / button いずれからも呼ばれるため、要素は HTMLElement に汎化する
    const handleCloseMdTab = useCallback(
      (e: React.MouseEvent<HTMLElement>) => {
        e.stopPropagation();
        if (!mdFilePath) return;
        const close = (): void => {
          useTerminalMetaStore.getState().clearMarkdown(id);
        };
        if (isDirty) {
          useMarkdownDialogStore.getState().showUnsaved({
            filePath: mdFilePath,
            paneId: id,
            reason: "open-other",
            onSave: async () => {
              const api = markdownEditorRegistry.getApi(id);
              const ok = api ? await api.save() : false;
              if (!ok) {
                showErrorToast("保存に失敗しました");
                return;
              }
              useMarkdownDialogStore.getState().dismiss();
              close();
            },
            onDiscard: () => {
              useMarkdownDialogStore.getState().dismiss();
              close();
            },
          });
          return;
        }
        close();
      },
      [id, mdFilePath, isDirty],
    );

    const mdFileName = useMemo(
      () => (mdFilePath ? getFileName(mdFilePath) : ""),
      [mdFilePath],
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
        {hasMarkdown ? (
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              gap: 0,
              flexShrink: 1,
              minWidth: 0,
              height: "100%",
            }}
          >
            <button
              type="button"
              onClick={handleClickCliTab}
              title="ターミナル表示に切替"
              style={{
                background: "transparent",
                border: "none",
                color: !isMd ? theme.colors.text : theme.colors.textSecondary,
                fontSize: 11,
                fontFamily: "inherit",
                padding: "0 8px",
                cursor: "pointer",
                borderBottom: !isMd
                  ? `2px solid ${theme.colors.accent}`
                  : "2px solid transparent",
                marginBottom: -1,
                fontWeight: !isMd ? 600 : 400,
              }}
            >
              CLI
            </button>
            <button
              type="button"
              onClick={handleClickMdTab}
              title={mdFilePath ?? ""}
              style={{
                background: "transparent",
                border: "none",
                color: isMd ? theme.colors.text : theme.colors.textSecondary,
                fontSize: 11,
                fontFamily: "inherit",
                padding: "0 4px 0 8px",
                cursor: "pointer",
                borderBottom: isMd
                  ? `2px solid ${theme.colors.accent}`
                  : "2px solid transparent",
                marginBottom: -1,
                fontWeight: isMd ? 600 : 400,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                maxWidth: 220,
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {mdFileName}
              </span>
              {isDirty && (
                <span
                  aria-label="未保存"
                  style={{
                    color: theme.colors.accent,
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  ●
                </span>
              )}
              <span
                role="button"
                aria-label="Markdown タブを閉じる"
                onClick={handleCloseMdTab}
                style={{
                  marginLeft: 2,
                  width: 14,
                  height: 14,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 3,
                  color: theme.colors.textSecondary,
                  fontSize: 12,
                  lineHeight: 1,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor =
                    theme.colors.buttonHover;
                  e.currentTarget.style.color = theme.colors.text;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = theme.colors.textSecondary;
                }}
              >
                ×
              </span>
            </button>
          </div>
        ) : (
          <>
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
          </>
        )}
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
