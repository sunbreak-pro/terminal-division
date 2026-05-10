import React, { useCallback, useRef, useState } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import {
  useMarkdownTabsStore,
  MD_TABS_MAX,
  type MdTab,
} from "../../stores/markdownTabsStore";
import {
  useMarkdownLayoutStore,
  useMdPane,
  useMdCanSplit,
} from "../../stores/markdownLayoutStore";
import { useMarkdownDialogStore } from "../../stores/markdownDialogStore";
import { MarkdownEditor } from "../MarkdownEditor";
import { RightSidebarFilePicker } from "./RightSidebarFilePicker";
import { showErrorToast } from "../Sidebar/ErrorToast";
import * as markdownEditorRegistry from "../../services/markdownEditorRegistry";
import { getFileName } from "../../utils/markdownFile";

interface MdPaneViewProps {
  paneId: string;
  // 1 ペインしかない時は close を許容しない（false にする）
  canClosePane: boolean;
}

// RightSidebar 内 1 ペインの表示。タブヘッダー + 分割/クローズボタン + MarkdownEditor。
export const MdPaneView: React.FC<MdPaneViewProps> = ({
  paneId,
  canClosePane,
}) => {
  const theme = useCurrentTheme();
  const themeConfig = useThemeConfig();

  const pane = useMdPane(paneId);
  const tabs = useMarkdownTabsStore((s) => s.tabs);
  const allTabsCount = tabs.length;
  const canOpenMore = allTabsCount < MD_TABS_MAX;

  const splitPane = useMarkdownLayoutStore((s) => s.splitPane);
  const closePane = useMarkdownLayoutStore((s) => s.closePane);
  const setActivePane = useMarkdownLayoutStore((s) => s.setActivePane);
  const setPaneActiveTab = useMarkdownLayoutStore((s) => s.setPaneActiveTab);
  const removeTabFromPane = useMarkdownLayoutStore((s) => s.removeTabFromPane);
  const activePaneId = useMarkdownLayoutStore((s) => s.activePaneId);
  const canSplitNow = useMdCanSplit()();

  const closeMarkdownTab = useMarkdownTabsStore((s) => s.closeTab);
  const showUnsaved = useMarkdownDialogStore((s) => s.showUnsaved);
  const dismissDialog = useMarkdownDialogStore((s) => s.dismiss);

  const plusButtonRef = useRef<HTMLButtonElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isPaneActive = activePaneId === paneId;

  const handleFocusPane = useCallback(() => {
    if (!isPaneActive) setActivePane(paneId);
  }, [isPaneActive, paneId, setActivePane]);

  const handleClickTab = useCallback(
    (tabId: string) => {
      setActivePane(paneId);
      setPaneActiveTab(paneId, tabId);
    },
    [paneId, setActivePane, setPaneActiveTab],
  );

  const handleCloseTab = useCallback(
    (e: React.MouseEvent<HTMLElement>, tab: MdTab) => {
      e.stopPropagation();
      const close = (): void => {
        // ペインの tabIds から削除し、グローバルタブも消す（共有はないため）。
        removeTabFromPane(paneId, tab.id);
        closeMarkdownTab(tab.id);
      };
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
    [paneId, removeTabFromPane, closeMarkdownTab, showUnsaved, dismissDialog],
  );

  const handleClickPlus = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (!canOpenMore) return;
      setActivePane(paneId);
      setPickerOpen((v) => !v);
    },
    [canOpenMore, paneId, setActivePane],
  );

  const handleSplitVertical = useCallback(() => {
    if (!canSplitNow) return;
    splitPane(paneId, "horizontal");
  }, [canSplitNow, paneId, splitPane]);

  const handleSplitHorizontal = useCallback(() => {
    if (!canSplitNow) return;
    splitPane(paneId, "vertical");
  }, [canSplitNow, paneId, splitPane]);

  const handleClosePane = useCallback(() => {
    if (!canClosePane) return;
    // ペインに dirty なタブがあれば 1 件目で警告（複数ある場合は順番に対応してもらう）
    if (!pane) return;
    const dirtyTabs = pane.tabIds
      .map((id) => tabs.find((t) => t.id === id))
      .filter((t): t is MdTab => !!t && t.dirty);
    const proceed = (): void => {
      // ペインの全タブをグローバルからも閉じる（ペイン消滅で参照が無くなるため）
      const ids = pane.tabIds.slice();
      closePane(paneId);
      for (const id of ids) closeMarkdownTab(id);
    };
    if (dirtyTabs.length > 0) {
      const t = dirtyTabs[0];
      showUnsaved({
        filePath: t.filePath,
        tabId: t.id,
        reason: "close-pane",
        onSave: async () => {
          const api = markdownEditorRegistry.getApi(t.id);
          const ok = api ? await api.save() : false;
          if (!ok) {
            showErrorToast("保存に失敗しました");
            return;
          }
          dismissDialog();
          proceed();
        },
        onDiscard: () => {
          dismissDialog();
          proceed();
        },
      });
      return;
    }
    proceed();
  }, [
    canClosePane,
    pane,
    tabs,
    paneId,
    closePane,
    closeMarkdownTab,
    showUnsaved,
    dismissDialog,
  ]);

  if (!pane) return null;

  const paneTabs = pane.tabIds
    .map((id) => tabs.find((t) => t.id === id))
    .filter((t): t is MdTab => !!t);

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

  const iconButtonStyle: React.CSSProperties = {
    background: "transparent",
    border: "none",
    color: theme.colors.textSecondary,
    cursor: "pointer",
    padding: "0 6px",
    height: "100%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };

  const disabledIconButtonStyle: React.CSSProperties = {
    ...iconButtonStyle,
    opacity: 0.4,
    cursor: "not-allowed",
  };

  return (
    <div
      data-md-pane-id={paneId}
      onMouseDown={handleFocusPane}
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.colors.headerBackground,
        // アクティブペインを薄く強調（terminal pane と同じ作法）。
        boxShadow: isPaneActive
          ? `inset 0 0 0 1px ${theme.colors.borderActive}`
          : "none",
      }}
    >
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
        {paneTabs.map((tab) => {
          const active = pane.activeTabId === tab.id;
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

        {/* 右端: ペイン操作ボタン群 */}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={handleSplitVertical}
          disabled={!canSplitNow}
          title="ペインを縦に分割"
          aria-label="ペインを縦に分割"
          style={canSplitNow ? iconButtonStyle : disabledIconButtonStyle}
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
          type="button"
          onClick={handleSplitHorizontal}
          disabled={!canSplitNow}
          title="ペインを横に分割"
          aria-label="ペインを横に分割"
          style={canSplitNow ? iconButtonStyle : disabledIconButtonStyle}
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
        {canClosePane && (
          <button
            type="button"
            onClick={handleClosePane}
            title="このペインを閉じる"
            aria-label="このペインを閉じる"
            style={iconButtonStyle}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {paneTabs.length === 0 ? (
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
          paneTabs.map((tab) => {
            const active = pane.activeTabId === tab.id;
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
    </div>
  );
};
