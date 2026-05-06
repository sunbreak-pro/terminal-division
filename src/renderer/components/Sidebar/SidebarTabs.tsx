import React, { useCallback, useState } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import { type CwdTab, homeRelativePath } from "../../utils/labelCollision";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { showErrorToast } from "./ErrorToast";
import { FolderTypeIcon } from "./icons";

interface SidebarTabsProps {
  tabs: CwdTab[];
  selectedCwd: string | null;
  onSelectTab: (tab: CwdTab) => void;
  /** ピン留めの ON/OFF を切り替える (pinned=false → pin、pinned=true → unpin) */
  onTogglePin?: (tab: CwdTab) => void;
  /** 「+ ツリーを追加」: ディレクトリ選択ダイアログを開いてピン留め登録 */
  onAddPinnedDir?: () => void;
  /** 表示モード ("files" / "git")。git のとき下半分に GitPanel が描画される */
  view?: "files" | "git";
  onSelectView?: (view: "files" | "git") => void;
}

export const SidebarTabs: React.FC<SidebarTabsProps> = ({
  tabs,
  selectedCwd,
  onSelectTab,
  onTogglePin,
  onAddPinnedDir,
  view = "files",
  onSelectView,
}) => {
  const theme = useCurrentTheme();
  const config = useThemeConfig();
  const homeDir = window.api.system.getHomeDir();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    tab: CwdTab;
  } | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleContextMenu = useCallback((e: React.MouseEvent, tab: CwdTab) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, tab });
  }, []);

  const buildItems = useCallback(
    (tab: CwdTab): ContextMenuItem[] => {
      const relative = homeRelativePath(tab.fullPath, homeDir);
      const items: ContextMenuItem[] = [
        {
          label: `相対パスをコピー: ${relative}`,
          onClick: () => {
            void navigator.clipboard
              .writeText(relative)
              .catch(() =>
                showErrorToast("クリップボードへのコピーに失敗しました"),
              );
          },
        },
        {
          label: `フルパスをコピー: ${tab.fullPath}`,
          onClick: () => {
            void navigator.clipboard
              .writeText(tab.fullPath)
              .catch(() =>
                showErrorToast("クリップボードへのコピーに失敗しました"),
              );
          },
        },
      ];
      if (onTogglePin) {
        items.push({
          label: tab.pinned ? "ピン留めを外す" : "ピン留めする",
          onClick: () => onTogglePin(tab),
        });
      }
      return items;
    },
    [homeDir, onTogglePin],
  );

  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      style={{
        display: "flex",
        flexDirection: "column",
        borderBottom: `1px solid ${theme.colors.border}`,
        flexShrink: 0,
      }}
    >
      {tabs.map((tab) => {
        const isSelected = view === "files" && tab.cwd === selectedCwd;
        return (
          <button
            key={tab.cwd}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => {
              // CWD タブ選択時は file ビューへ
              onSelectView?.("files");
              onSelectTab(tab);
            }}
            onContextMenu={(e) => handleContextMenu(e, tab)}
            title={tab.fullPath}
            style={{
              padding: `${config.spacing.sm} ${config.spacing.sm}`,
              backgroundColor: isSelected
                ? theme.colors.background
                : "transparent",
              color: isSelected
                ? theme.colors.text
                : theme.colors.textSecondary,
              border: "none",
              borderLeft: isSelected
                ? `3px solid ${theme.colors.activeTerminal}`
                : "3px solid transparent",
              borderBottom: `1px solid ${theme.colors.border}`,
              textAlign: "left",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              gap: 8,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minHeight: 34,
            }}
            onMouseEnter={(e) => {
              if (!isSelected) {
                e.currentTarget.style.backgroundColor =
                  theme.colors.buttonHover;
              }
            }}
            onMouseLeave={(e) => {
              if (!isSelected) {
                e.currentTarget.style.backgroundColor = "transparent";
              }
            }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-flex",
                alignItems: "center",
                color: isSelected
                  ? theme.colors.activeTerminal
                  : theme.colors.textSecondary,
                flexShrink: 0,
              }}
            >
              <FolderTypeIcon
                name={tab.fullPath.split("/").pop() || tab.fullPath}
                size={14}
              />
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
            >
              {tab.label}
            </span>
            {tab.pinned && (
              <span
                aria-hidden
                title={
                  tab.paneIds.length === 0
                    ? "ピン留め (ペイン無し)"
                    : "ピン留め"
                }
                style={{
                  fontSize: 11,
                  color: isSelected
                    ? theme.colors.activeTerminal
                    : theme.colors.textSecondary,
                  flexShrink: 0,
                }}
              >
                📌
              </span>
            )}
            {tab.paneIds.length > 1 && (
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 10,
                  color: theme.colors.textSecondary,
                  backgroundColor: theme.colors.border,
                  padding: "1px 6px",
                  borderRadius: 8,
                }}
              >
                {tab.paneIds.length}
              </span>
            )}
          </button>
        );
      })}

      {onAddPinnedDir && (
        <button
          type="button"
          onClick={onAddPinnedDir}
          title="ディレクトリを選択して追加ツリーをピン留め"
          style={{
            padding: `${config.spacing.sm} ${config.spacing.sm}`,
            backgroundColor: "transparent",
            color: theme.colors.textSecondary,
            border: "none",
            borderLeft: "3px solid transparent",
            borderBottom: `1px solid ${theme.colors.border}`,
            textAlign: "left",
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            gap: 8,
            minHeight: 30,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <span aria-hidden style={{ width: 14, textAlign: "center" }}>
            +
          </span>
          <span>ツリーを追加</span>
        </button>
      )}

      {onSelectView && (
        <button
          type="button"
          role="tab"
          aria-selected={view === "git"}
          onClick={() => onSelectView("git")}
          title="Git: 選択中の CWD のリポジトリを操作"
          style={{
            padding: `${config.spacing.sm} ${config.spacing.sm}`,
            backgroundColor:
              view === "git" ? theme.colors.background : "transparent",
            color:
              view === "git" ? theme.colors.text : theme.colors.textSecondary,
            border: "none",
            borderLeft:
              view === "git"
                ? `3px solid ${theme.colors.activeTerminal}`
                : "3px solid transparent",
            borderBottom: `1px solid ${theme.colors.border}`,
            textAlign: "left",
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            gap: 8,
            minHeight: 30,
          }}
          onMouseEnter={(e) => {
            if (view !== "git") {
              e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
            }
          }}
          onMouseLeave={(e) => {
            if (view !== "git") {
              e.currentTarget.style.backgroundColor = "transparent";
            }
          }}
        >
          <span
            aria-hidden
            style={{
              width: 14,
              textAlign: "center",
              fontWeight: 600,
            }}
          >
            ⎇
          </span>
          <span>Git</span>
        </button>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildItems(menu.tab)}
          onClose={closeMenu}
        />
      )}
    </div>
  );
};
