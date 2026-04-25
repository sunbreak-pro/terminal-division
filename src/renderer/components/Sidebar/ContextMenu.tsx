import React, { useEffect, useRef } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  items,
  onClose,
}) => {
  const theme = useCurrentTheme();
  const config = useThemeConfig();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    // mousedown を使うと選択前に閉じてしまうため click をリッスン
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("contextmenu", handleDocumentClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
      document.removeEventListener("contextmenu", handleDocumentClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // ビューポートからはみ出さないように調整
  const adjusted = React.useMemo(() => {
    const menuWidth = 200;
    const menuHeight = items.length * 28 + 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = x + menuWidth > vw ? Math.max(0, vw - menuWidth - 4) : x;
    const top = y + menuHeight > vh ? Math.max(0, vh - menuHeight - 4) : y;
    return { left, top };
  }, [x, y, items.length]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        left: adjusted.left,
        top: adjusted.top,
        minWidth: 200,
        backgroundColor: theme.colors.headerBackground,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: config.borderRadius,
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        padding: "4px 0",
        zIndex: 9999,
        userSelect: "none",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, idx) => (
        <React.Fragment key={`${item.label}-${idx}`}>
          {item.separatorBefore && (
            <div
              style={{
                height: 1,
                backgroundColor: theme.colors.border,
                margin: "4px 0",
              }}
            />
          )}
          <button
            type="button"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "6px 12px",
              backgroundColor: "transparent",
              color: item.disabled
                ? theme.colors.textSecondary
                : item.danger
                  ? theme.colors.danger
                  : theme.colors.text,
              border: "none",
              cursor: item.disabled ? "not-allowed" : "pointer",
              fontSize: 12,
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) {
                e.currentTarget.style.backgroundColor =
                  theme.colors.buttonHover;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};
