import React, { useCallback, useEffect, useRef } from "react";
import { useCurrentTheme } from "../../stores/themeStore";
import {
  useRightSidebarStore,
  RIGHT_SIDEBAR_WIDTH_BOUNDS,
} from "../../stores/rightSidebarStore";

interface ResizeHandleProps {
  // 右サイドバー親要素の右端 x を取るために ref を受け取る。
  containerRef: React.RefObject<HTMLDivElement | null>;
}

// 右サイドバー左端のリサイズハンドル。左サイドバーと逆向きで
// 「右端から見た幅」= containerRect.right - cursorX を計算する。
export const RightSidebarResizeHandle: React.FC<ResizeHandleProps> = ({
  containerRef,
}) => {
  const theme = useCurrentTheme();
  const setWidth = useRightSidebarStore((s) => s.setWidth);
  const draggingRef = useRef(false);
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setActive(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      if (!draggingRef.current) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // 右サイドバーは右端固定。マウス位置から右端までの距離が新しい幅。
      // ハンドル幅 (4px) の中央寄せ補正で +2。
      const next = rect.right - e.clientX + 2;
      setWidth(next);
    };
    const handleMouseUp = (): void => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setActive(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const width = useRightSidebarStore.getState().width;
      window.api.rightSidebar.setWidth(width);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [containerRef, setWidth]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={RIGHT_SIDEBAR_WIDTH_BOUNDS.min}
      aria-valuemax={RIGHT_SIDEBAR_WIDTH_BOUNDS.max}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "absolute",
        top: 0,
        left: -2,
        width: 4,
        height: "100%",
        cursor: "col-resize",
        backgroundColor:
          active || hover ? theme.colors.borderActive : "transparent",
        transition: "background-color 0.1s ease",
        zIndex: 5,
      }}
    />
  );
};
