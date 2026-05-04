import React, { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import {
  useRightSidebarStore,
  useRightSidebarOpen,
  useRightSidebarWidth,
  clampRightSidebarWidth,
} from "../../stores/rightSidebarStore";
import {
  useMarkdownTabsStore,
  type MdTab,
  MD_TABS_MAX,
} from "../../stores/markdownTabsStore";
import { MarkdownEditor } from "../MarkdownEditor";
import { RightSidebarResizeHandle } from "./RightSidebarResizeHandle";
import { RightSidebarFilePicker } from "./RightSidebarFilePicker";
import { useMarkdownDialogStore } from "../../stores/markdownDialogStore";
import * as markdownEditorRegistry from "../../services/markdownEditorRegistry";
import { showErrorToast } from "../Sidebar/ErrorToast";
import { getFileName } from "../../utils/markdownFile";

// 右サイドバー（Markdown 表示エリア）。Header 右側のトグルボタン or
// Markdown ファイルクリックで開閉する。タブが空でも開ける（その場合は空状態を表示）。
export const RightSidebar: React.FC = () => {
  const theme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const isOpen = useRightSidebarOpen();
  const width = useRightSidebarWidth();
  const setWidth = useRightSidebarStore((s) => s.setWidth);

  const tabs = useMarkdownTabsStore((s) => s.tabs);
  const activeTabId = useMarkdownTabsStore((s) => s.activeTabId);
  const setActive = useMarkdownTabsStore((s) => s.setActive);
  const closeTab = useMarkdownTabsStore((s) => s.closeTab);

  const showUnsaved = useMarkdownDialogStore((s) => s.showUnsaved);
  const dismissDialog = useMarkdownDialogStore((s) => s.dismiss);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const plusButtonRef = useRef<HTMLButtonElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // 永続化値の取得が終わるまで isOpen の IPC 送信を保留する。
  // この保留がないと、初期 isOpen=false がそのまま main に送信されて
  // 前回保存した open=true を上書きしてしまう。
  const [openInitialized, setOpenInitialized] = useState(false);

  // 起動時に永続化された幅を復元
  useEffect(() => {
    let canceled = false;
    void window.api.rightSidebar.getWidth().then((w) => {
      if (!canceled && typeof w === "number") {
        setWidth(w);
      }
    });
    return () => {
      canceled = true;
    };
  }, [setWidth]);

  // 起動時に永続化された開閉状態を復元
  useEffect(() => {
    let canceled = false;
    void window.api.rightSidebar.getOpen().then((open) => {
      if (canceled) return;
      if (typeof open === "boolean" && open) {
        useRightSidebarStore.getState().setOpen(true);
      }
      setOpenInitialized(true);
    });
    return () => {
      canceled = true;
    };
  }, []);

  // ウィンドウリサイズで実効最大幅が変わるので、現在幅を再 clamp して永続化
  useEffect(() => {
    const handler = (): void => {
      const current = useRightSidebarStore.getState().width;
      const clamped = clampRightSidebarWidth(current);
      if (clamped !== current) {
        setWidth(clamped);
        window.api.rightSidebar.setWidth(clamped);
      }
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [setWidth]);

  // 開閉状態が変わったら永続化（初期化完了後のみ）
  useEffect(() => {
    if (!openInitialized) return;
    window.api.rightSidebar.setOpen(isOpen);
  }, [isOpen, openInitialized]);

  const canOpenMore = tabs.length < MD_TABS_MAX;

  const handleClickPlus = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (!canOpenMore) return;
      setPickerOpen((v) => !v);
    },
    [canOpenMore],
  );

  const handleClickTab = useCallback(
    (tabId: string) => {
      setActive(tabId);
    },
    [setActive],
  );

  const handleCloseTab = useCallback(
    (e: React.MouseEvent<HTMLElement>, tab: MdTab) => {
      e.stopPropagation();
      const close = (): void => closeTab(tab.id);
      if (tab.dirty) {
        showUnsaved({
          filePath: tab.filePath,
          tabId: tab.id,
          reason: "open-other",
          onSave: async () => {
            const api = markdownEditorRegistry.getApi(tab.id);
            const ok = api ? await api.save() : false;
            if (!ok) {
              showErrorToast("保存に失敗しました");
              return;
            }
            dismissDialog();
            close();
          },
          onDiscard: () => {
            dismissDialog();
            close();
          },
        });
        return;
      }
      close();
    },
    [closeTab, showUnsaved, dismissDialog],
  );

  if (!isOpen) return null;

  const tabButtonStyle = (active: boolean): React.CSSProperties => ({
    background: "transparent",
    border: "none",
    color: active ? theme.colors.text : theme.colors.textSecondary,
    fontSize: 12,
    fontFamily: "inherit",
    letterSpacing: "0.02em",
    padding: "0 8px",
    cursor: "pointer",
    borderBottom: active
      ? `2px solid ${theme.colors.accent}`
      : "2px solid transparent",
    marginBottom: -1,
    fontWeight: active ? 700 : 500,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    maxWidth: 200,
    overflow: "hidden",
    flexShrink: 0,
    height: "100%",
    whiteSpace: "nowrap",
  });

  return (
    <aside
      ref={containerRef}
      data-right-sidebar-root="true"
      style={{
        position: "relative",
        width,
        flexShrink: 0,
        height: "100%",
        backgroundColor: theme.colors.headerBackground,
        borderLeft: `1px solid ${theme.colors.border}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <RightSidebarResizeHandle containerRef={containerRef} />
      {/* タブヘッダー */}
      <div
        style={{
          height: 32,
          minHeight: 32,
          display: "flex",
          alignItems: "stretch",
          backgroundColor: theme.colors.headerBackground,
          borderBottom: `1px solid ${theme.colors.border}`,
          padding: "0 4px",
          gap: 0,
          overflowX: "auto",
          overflowY: "hidden",
        }}
      >
        {tabs.map((tab) => {
          const active = activeTabId === tab.id;
          const fileName = getFileName(tab.filePath);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleClickTab(tab.id)}
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
                onClick={(e) => handleCloseTab(e, tab)}
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
        <button
          ref={plusButtonRef}
          type="button"
          onClick={handleClickPlus}
          title={
            canOpenMore
              ? "Markdown ファイルを追加で開く"
              : `Markdown タブの上限（${MD_TABS_MAX}）に達しました`
          }
          aria-label="Markdown ファイルを追加で開く"
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
            paddingLeft: 10,
            paddingRight: 10,
          }}
        >
          +
        </button>
      </div>

      {/* 本体: タブが空なら空状態、あれば全タブを mount し続けて active のみ表示 */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {tabs.length === 0 ? (
          <div
            style={{
              height: "100%",
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: themeConfig.spacing.lg,
              color: theme.colors.textSecondary,
              fontSize: 13,
              textAlign: "center",
            }}
          >
            ファイルを選択してください
          </div>
        ) : (
          tabs.map((tab) => {
            const active = activeTabId === tab.id;
            return (
              <div
                key={`${tab.id}-${tab.loadedAt}`}
                style={{
                  position: "absolute",
                  inset: 0,
                  display: active ? "block" : "none",
                }}
              >
                <MarkdownEditor tabId={tab.id} />
              </div>
            );
          })
        )}
      </div>

      {pickerOpen && (
        <RightSidebarFilePicker
          anchorEl={plusButtonRef.current}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </aside>
  );
};
