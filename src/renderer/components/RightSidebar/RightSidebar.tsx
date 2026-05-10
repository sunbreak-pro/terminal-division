import React, { useEffect, useRef, useState } from "react";
import { useCurrentTheme } from "../../stores/themeStore";
import {
  useRightSidebarStore,
  useRightSidebarOpen,
  useRightSidebarWidth,
  useRightSidebarFullscreen,
  clampRightSidebarWidth,
} from "../../stores/rightSidebarStore";
import { RightSidebarResizeHandle } from "./RightSidebarResizeHandle";
import { MdSplitContainer } from "./MdSplitContainer";

// 右サイドバー（Markdown 表示エリア）。Header 右側のトグルボタン or
// Markdown ファイルクリックで開閉する。タブ・ペインが空でも開ける。
// ペイン分割と各ペイン内のタブヘッダーは MdSplitContainer / MdPaneView で扱う。
export const RightSidebar: React.FC = () => {
  const theme = useCurrentTheme();
  const isOpen = useRightSidebarOpen();
  const width = useRightSidebarWidth();
  const isFullscreen = useRightSidebarFullscreen();
  const setWidth = useRightSidebarStore((s) => s.setWidth);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // 永続化値の取得が終わるまで isOpen の IPC 送信を保留する。
  // この保留がないと、初期 isOpen=false がそのまま main に送信されて
  // 前回保存した open=true を上書きしてしまう。
  const [openInitialized, setOpenInitialized] = useState(false);
  const [fullscreenInitialized, setFullscreenInitialized] = useState(false);

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

  // 起動時に永続化された全画面状態を復元
  useEffect(() => {
    let canceled = false;
    void window.api.rightSidebar.getFullscreen().then((fullscreen) => {
      if (canceled) return;
      if (typeof fullscreen === "boolean" && fullscreen) {
        useRightSidebarStore.getState().setFullscreen(true);
      }
      setFullscreenInitialized(true);
    });
    return () => {
      canceled = true;
    };
  }, []);

  // 全画面状態が変わったら永続化（初期化完了後のみ）
  useEffect(() => {
    if (!fullscreenInitialized) return;
    window.api.rightSidebar.setFullscreen(isFullscreen);
  }, [isFullscreen, fullscreenInitialized]);

  if (!isOpen) return null;

  return (
    <aside
      ref={containerRef}
      data-right-sidebar-root="true"
      data-right-sidebar-fullscreen={isFullscreen ? "true" : "false"}
      style={{
        position: "relative",
        width: isFullscreen ? "100%" : width,
        flex: isFullscreen ? 1 : "0 0 auto",
        flexShrink: 0,
        height: "100%",
        backgroundColor: theme.colors.headerBackground,
        borderLeft: isFullscreen ? "none" : `1px solid ${theme.colors.border}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* 全画面時はリサイズハンドル不要 */}
      {!isFullscreen && (
        <RightSidebarResizeHandle containerRef={containerRef} />
      )}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <MdSplitContainer />
      </div>
    </aside>
  );
};
