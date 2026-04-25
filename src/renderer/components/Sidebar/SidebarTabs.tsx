import React, { useCallback, useState } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import { type CwdTab, homeRelativePath } from "../../utils/labelCollision";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { showErrorToast } from "./ErrorToast";
import { FolderIcon } from "./icons";

interface SidebarTabsProps {
  tabs: CwdTab[];
  selectedCwd: string | null;
  onSelectTab: (tab: CwdTab) => void;
}

export const SidebarTabs: React.FC<SidebarTabsProps> = ({
  tabs,
  selectedCwd,
  onSelectTab,
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
      return [
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
    },
    [homeDir],
  );

  if (tabs.length === 0) return null;

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
        const isSelected = tab.cwd === selectedCwd;
        return (
          <button
            key={tab.cwd}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelectTab(tab)}
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
              <FolderIcon size={14} />
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
