import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  useTerminalMeta,
  useTerminalMetaStore,
  type MdTab,
} from "../stores/terminalMetaStore";
import { useTerminalActions, useTerminalCount } from "../stores/terminalStore";
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";
import { useTerminalSettings } from "../stores/settingsStore";
import { promptAndInsertFiles } from "../utils/insertFiles";
import * as terminalManager from "../services/terminalManager";
import * as markdownEditorRegistry from "../services/markdownEditorRegistry";
import { useMarkdownDialogStore } from "../stores/markdownDialogStore";
import { getFileName } from "../utils/markdownFile";
import { showErrorToast } from "./Sidebar/ErrorToast";
import { ContextMenu, ContextMenuItem } from "./Sidebar/ContextMenu";
import { MdTabPickerDropdown } from "./MdTabPickerDropdown";

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
    const terminalSettings = useTerminalSettings();
    // ペイン番号は terminal 本体と同じ実効フォントサイズに揃える。
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

    // フォルダ名のみ取得
    const folderName = useMemo(() => {
      if (displayCwd === "~") return "~";
      const parts = displayCwd.split("/");
      return parts[parts.length - 1] || displayCwd;
    }, [displayCwd]);

    // ペインタイトル inline rename。customTitle が設定されていれば優先表示。
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
    const mdTabs = meta?.mdTabs ?? [];
    const activeMdTabId = meta?.activeMdTabId ?? null;
    const isMd = meta?.viewMode === "md";
    const canOpenMore = mdTabs.length < 8;

    const showTabs = mdTabs.length > 0;

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
        if (meta?.viewMode === "cli") return;
        switchToMode("cli");
      },
      [meta?.viewMode, switchToMode],
    );

    // 個別 MD タブをクリック: そのタブをアクティブ化 + viewMode=md
    const handleClickMdTab = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>, tabId: string) => {
        e.stopPropagation();
        const store = useTerminalMetaStore.getState();
        store.setActiveMdTab(id, tabId);
        store.setViewMode(id, "md");
      },
      [id],
    );

    // 個別 MD タブの × をクリック: dirty なら警告、なければ即座に閉じる
    const handleCloseMdTab = useCallback(
      (e: React.MouseEvent<HTMLElement>, tab: MdTab) => {
        e.stopPropagation();
        const close = (): void => {
          useTerminalMetaStore.getState().closeMdTab(id, tab.id);
        };
        if (tab.dirty) {
          useMarkdownDialogStore.getState().showUnsaved({
            filePath: tab.filePath,
            paneId: id,
            tabId: tab.id,
            reason: "open-other",
            onSave: async () => {
              const api = markdownEditorRegistry.getApi(tab.id);
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
      [id],
    );

    // ペインを閉じる × ボタン。Header のグローバル閉じるボタンを廃止して
    // ペインごとに配置する（操作対象が明確になり、誤操作も減る）。
    // dirty な MD タブがある場合は警告フローに乗せず、本体ペイン閉鎖は
    // App.tsx の close-pane ショートカット側で扱っている dirty チェックを
    // ここでは省略して即時閉鎖する（タブ単位の警告は既存 × ボタンで担保）。
    const { closeTerminal } = useTerminalActions();
    const terminalCount = useTerminalCount();
    const canClosePane = terminalCount > 1;
    const handleClosePane = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>): void => {
        e.stopPropagation();
        if (!canClosePane) return;
        // dirty な MD タブが当該ペインにあれば閉じる前に警告
        const meta = useTerminalMetaStore.getState().metas.get(id);
        const dirtyTab = meta?.mdTabs.find((t) => t.dirty);
        if (dirtyTab) {
          useMarkdownDialogStore.getState().showUnsaved({
            filePath: dirtyTab.filePath,
            paneId: id,
            tabId: dirtyTab.id,
            reason: "close-pane",
            onSave: async () => {
              const dialogStore = useMarkdownDialogStore.getState();
              const editorApi = markdownEditorRegistry.getApi(dirtyTab.id);
              const ok = editorApi ? await editorApi.save() : false;
              if (!ok) {
                showErrorToast("保存に失敗しました");
                return;
              }
              dialogStore.dismiss();
              closeTerminal(id);
            },
            onDiscard: () => {
              useMarkdownDialogStore.getState().dismiss();
              closeTerminal(id);
            },
          });
          return;
        }
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

    // ===== MD タブピッカードロップダウン =====
    const plusButtonRef = useRef<HTMLButtonElement | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const handleClickPlus = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (!canOpenMore) return; // 上限到達時は no-op
        setPickerOpen((v) => !v);
      },
      [canOpenMore],
    );
    const closePicker = useCallback(() => setPickerOpen(false), []);

    // スクロールバック削除メニュー: クリックでアイコン下にポップオーバーを開く
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

    // 共通アイコンボタンスタイル（挿入 / クリア）
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

    // タブボタンの共通スタイル生成
    const tabButtonStyle = (active: boolean): React.CSSProperties => ({
      background: "transparent",
      border: "none",
      color: active ? theme.colors.text : theme.colors.textSecondary,
      fontSize: 12,
      fontFamily: "inherit",
      letterSpacing: "0.02em",
      padding: "0 6px",
      cursor: "pointer",
      borderBottom: active
        ? `2px solid ${theme.colors.accent}`
        : "2px solid transparent",
      marginBottom: -1,
      fontWeight: active ? 700 : 500,
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      maxWidth: 180,
      overflow: "hidden",
      flexShrink: 0,
    });

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
        {/* タイトル / CWD は常に表示する。タブを開いていても消さない */}
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
              maxWidth: showTabs ? 160 : undefined,
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
        {!showTabs && (
          <>
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
          </>
        )}
        {showTabs && (
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              gap: 0,
              flexShrink: 1,
              minWidth: 0,
              height: "100%",
              marginLeft: 4,
              borderLeft: `1px solid ${theme.colors.border}`,
              paddingLeft: 4,
              overflowX: "auto",
              overflowY: "hidden",
            }}
          >
            <button
              type="button"
              onClick={handleClickCliTab}
              title="ターミナル表示に切替"
              style={tabButtonStyle(meta?.viewMode === "cli")}
            >
              CLI
            </button>
            {mdTabs.map((tab) => {
              const fileName = getFileName(tab.filePath);
              const active = isMd && activeMdTabId === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={(e) => handleClickMdTab(e, tab.id)}
                  title={tab.filePath}
                  style={tabButtonStyle(active)}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fileName}
                  </span>
                  {tab.dirty && (
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
                    aria-label="タブを閉じる"
                    onClick={(e) => handleCloseMdTab(e, tab)}
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
              );
            })}
            {/* + ボタン: MD タブを開く（mdTabs > 0 のときのみ表示。ペイン初回はサイドバーから開く） */}
            {mdTabs.length > 0 && (
              <button
                ref={plusButtonRef}
                type="button"
                onClick={handleClickPlus}
                title={
                  canOpenMore
                    ? "Markdown タブを追加"
                    : "Markdown タブの上限（8）に達しました"
                }
                aria-label="Markdown タブを追加"
                aria-disabled={!canOpenMore}
                style={{
                  ...tabButtonStyle(false),
                  cursor: canOpenMore ? "pointer" : "not-allowed",
                  color: canOpenMore
                    ? theme.colors.textSecondary
                    : theme.colors.border,
                  opacity: canOpenMore ? 1 : 0.5,
                  fontSize: 14,
                  fontWeight: 600,
                  paddingLeft: 8,
                  paddingRight: 8,
                }}
              >
                +
              </button>
            )}
          </div>
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
        {pickerOpen && (
          <MdTabPickerDropdown
            paneId={id}
            anchorEl={plusButtonRef.current}
            onClose={closePicker}
          />
        )}
      </div>
    );
  },
);

TerminalSubHeader.displayName = "TerminalSubHeader";

export { TerminalSubHeader };
