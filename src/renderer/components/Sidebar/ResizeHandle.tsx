import React, { useCallback, useEffect, useRef } from "react";
import { useCurrentTheme } from "../../stores/themeStore";
import {
  useSidebarStore,
  SIDEBAR_WIDTH_BOUNDS,
} from "../../stores/sidebarStore";

interface ResizeHandleProps {
  // 親要素の left からのドラッグ起点を計算するために、親左端の x を取れるよう ref を受け取る
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({ containerRef }) => {
  const theme = useCurrentTheme();
  const setWidth = useSidebarStore((s) => s.setWidth);
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
      const next = e.clientX - rect.left;
      // ハンドル幅 (4px) の中央寄せ補正
      setWidth(next + 2);
    };
    const handleMouseUp = (): void => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setActive(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // ドラッグ終了時に永続化
      const width = useSidebarStore.getState().width;
      window.api.sidebar.setWidth(width);
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
      aria-valuemin={SIDEBAR_WIDTH_BOUNDS.min}
      aria-valuemax={SIDEBAR_WIDTH_BOUNDS.max}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "absolute",
        top: 0,
        right: -2,
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
