import React from "react";
import { usePathHoverStore } from "../stores/pathHoverStore";
import { useCurrentTheme } from "../stores/themeStore";

/**
 * ターミナル上のパスを hover した時にカーソル付近に表示する tooltip。
 * 画面に 1 つだけ存在し、`pathHoverStore` の state を反映する。
 *
 * - `position: fixed` + viewport 基準の clientX/Y で配置
 * - `pointer-events: none` でターミナル側の hover を妨げない
 * - 文言は固定: 「⌘+クリックで開く」(macOS)、「Ctrl+クリックで開く」(その他)
 *   現状 macOS が一級サポートなので前者を表示。
 */
export const PathHoverTooltip: React.FC = () => {
  const { visible, text, x, y } = usePathHoverStore();
  const theme = useCurrentTheme();

  if (!visible) return null;

  // カーソル右下 8/16px のオフセット (アイコン的に余白を取る)
  const left = x + 8;
  const top = y + 16;

  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <div
      role="tooltip"
      aria-label={`${modKey}+クリックで開く`}
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 10000,
        pointerEvents: "none",
        background: theme.colors.headerBackground,
        color: theme.colors.text,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: 6,
        padding: "6px 10px",
        fontSize: 12,
        lineHeight: 1.4,
        boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
        maxWidth: 480,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      <div style={{ fontWeight: 600 }}>{modKey}+クリックで開く</div>
      <div
        style={{
          opacity: 0.7,
          fontSize: 11,
          marginTop: 2,
          fontFamily:
            '"Menlo", "Monaco", "SFMono-Regular", "Courier New", monospace',
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {text}
      </div>
    </div>
  );
};
