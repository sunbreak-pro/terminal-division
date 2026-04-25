import React, { useEffect, useMemo, useRef } from "react";
import { useCurrentTheme } from "../../stores/themeStore";
import {
  useSidebarStore,
  useSidebarOpen,
  useSidebarWidth,
} from "../../stores/sidebarStore";
import { useTerminalMetaStore } from "../../stores/terminalMetaStore";
import {
  useActiveTerminalId,
  useTerminalActions,
} from "../../stores/terminalStore";
import {
  buildCwdTabs,
  type CwdTab,
  type PaneCwdInput,
} from "../../utils/labelCollision";
import { SidebarTabs } from "./SidebarTabs";
import { DirectoryTree } from "./DirectoryTree";
import { ResizeHandle } from "./ResizeHandle";
import { UndoRedoToolbar } from "./UndoRedoToolbar";
import { useFileTreeStore } from "../../stores/fileTreeStore";
import { showErrorToast } from "./ErrorToast";

export const Sidebar: React.FC = () => {
  const theme = useCurrentTheme();
  const isOpen = useSidebarOpen();
  const width = useSidebarWidth();
  const setWidth = useSidebarStore((s) => s.setWidth);
  const selectedTabCwd = useSidebarStore((s) => s.selectedTabCwd);
  const setSelectedTabCwd = useSidebarStore((s) => s.setSelectedTabCwd);
  const setLastInteractedArea = useSidebarStore((s) => s.setLastInteractedArea);

  const metas = useTerminalMetaStore((s) => s.metas);
  const activeTerminalId = useActiveTerminalId();
  const { setActiveTerminal } = useTerminalActions();

  const containerRef = useRef<HTMLDivElement | null>(null);

  // 起動時に永続化された幅を復元
  useEffect(() => {
    let canceled = false;
    void window.api.sidebar.getWidth().then((w) => {
      if (!canceled && typeof w === "number") {
        setWidth(w);
      }
    });
    return () => {
      canceled = true;
    };
  }, [setWidth]);

  // chokidar の連続エラーを Main 側で閾値判定 → 通知して toast 表示
  useEffect(() => {
    const unsub = window.api.fs.onWatcherError(({ dirPath }) => {
      showErrorToast(`ファイル監視が失敗しています: ${dirPath}`);
    });
    return unsub;
  }, []);

  // ペインメタから CWD タブを構築
  const tabs: CwdTab[] = useMemo(() => {
    const inputs: PaneCwdInput[] = [];
    for (const [paneId, meta] of metas.entries()) {
      if (meta.cwd) {
        inputs.push({
          paneId,
          cwd: meta.cwd,
          createdAt: meta.createdAt,
          lastActiveAt: meta.lastActiveAt,
        });
      }
    }
    return buildCwdTabs(inputs);
  }, [metas]);

  // アクティブペインの CWD に対応するタブを自動選択（双方向同期その 1）
  useEffect(() => {
    if (!activeTerminalId) return;
    const activeMeta = metas.get(activeTerminalId);
    const activeCwd = activeMeta?.cwd;
    if (!activeCwd) return;
    // 末尾スラッシュ正規化はタブ側で済んでいる
    const matched = tabs.find((t) => t.paneIds.includes(activeTerminalId));
    if (matched && matched.cwd !== selectedTabCwd) {
      setSelectedTabCwd(matched.cwd);
    }
  }, [activeTerminalId, metas, tabs, selectedTabCwd, setSelectedTabCwd]);

  // 選択中タブが消えた場合のフォールバック
  useEffect(() => {
    if (tabs.length === 0) {
      if (selectedTabCwd !== null) setSelectedTabCwd(null);
      return;
    }
    if (!selectedTabCwd || !tabs.find((t) => t.cwd === selectedTabCwd)) {
      setSelectedTabCwd(tabs[0].cwd);
    }
  }, [tabs, selectedTabCwd, setSelectedTabCwd]);

  // タブを切り替えた瞬間にそのツリーを強制再読み込み（chokidar が
  // バックグラウンドで取り逃した変更を拾う）
  useEffect(() => {
    if (!selectedTabCwd) return;
    void useFileTreeStore.getState().refreshAllExpanded(selectedTabCwd);
  }, [selectedTabCwd]);

  const handleSelectTab = (tab: CwdTab): void => {
    setSelectedTabCwd(tab.cwd);
    // 集約ペイン群のうち直近アクティブだったペインをアクティブ化（双方向同期その 2）
    if (tab.lastActivePaneId !== activeTerminalId) {
      setActiveTerminal(tab.lastActivePaneId);
    }
  };

  if (!isOpen) return null;

  return (
    <aside
      ref={containerRef}
      data-sidebar-root="true"
      onMouseDownCapture={() => setLastInteractedArea("sidebar")}
      style={{
        position: "relative",
        width,
        flexShrink: 0,
        height: "100%",
        backgroundColor: theme.colors.headerBackground,
        borderRight: `1px solid ${theme.colors.border}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <UndoRedoToolbar />
      {tabs.length === 0 ? (
        <div
          style={{
            padding: 12,
            fontSize: 11,
            color: theme.colors.textSecondary,
          }}
        >
          ターミナルが起動するとここに CWD が表示されます
        </div>
      ) : (
        <>
          <SidebarTabs
            tabs={tabs}
            selectedCwd={selectedTabCwd}
            onSelectTab={handleSelectTab}
          />
          {selectedTabCwd && <DirectoryTree rootPath={selectedTabCwd} />}
        </>
      )}

      <ResizeHandle containerRef={containerRef} />
    </aside>
  );
};
