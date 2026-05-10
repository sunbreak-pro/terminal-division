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
  // 永続化値の取得が終わるまで isOpen / isFullscreen の IPC 送信を保留する。
  // この保留がないと、初期 false 値がそのまま main に送信されて前回保存値を上書きしてしまう。
  const [persistInitialized, setPersistInitialized] = useState(false);

  // 起動時に永続化された width / open / fullscreen を一括復元する。
  // 旧実装では 3 本の useEffect が独立に走り、各 then() の resolve タイミングが
  // ~10〜100ms ずれて 3 連続のレイアウト変更（=メインターミナル領域の width 振動）を
  // 引き起こしていた。これが PTY resize IPC の連発と SIGWINCH スパムを誘発し、
  // 前面 TUI（Claude Code 等）の再描画で長文が複製される原因の 1 つになっていた。
  // Promise.all で 3 値を同時に取得し、setState を 1 フレーム内に集約することで
  // ResizeObserver / Panel.onResize が 1 度しか発火しないようにする。
  useEffect(() => {
    let canceled = false;
    void Promise.all([
      window.api.rightSidebar.getWidth(),
      window.api.rightSidebar.getOpen(),
      window.api.rightSidebar.getFullscreen(),
    ]).then(([w, open, fullscreen]) => {
      if (canceled) return;
      const store = useRightSidebarStore.getState();
      if (typeof w === "number") store.setWidth(w);
      if (typeof open === "boolean" && open) store.setOpen(true);
      if (typeof fullscreen === "boolean" && fullscreen) {
        store.setFullscreen(true);
      }
      setPersistInitialized(true);
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
    if (!persistInitialized) return;
    window.api.rightSidebar.setOpen(isOpen);
  }, [isOpen, persistInitialized]);

  // 全画面状態が変わったら永続化（初期化完了後のみ）
  useEffect(() => {
    if (!persistInitialized) return;
    window.api.rightSidebar.setFullscreen(isFullscreen);
  }, [isFullscreen, persistInitialized]);

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
