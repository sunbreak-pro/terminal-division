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
import { GitPanel } from "./GitPanel";
import { useFileTreeStore } from "../../stores/fileTreeStore";
import { showErrorToast } from "./ErrorToast";
import { usePinnedDirsStore } from "../../stores/pinnedDirsStore";
import { useSettingsModalStore } from "../../stores/settingsModalStore";

interface SidebarProps {
  onRequestEditMarkdown?: (filePath: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onRequestEditMarkdown }) => {
  const theme = useCurrentTheme();
  const isOpen = useSidebarOpen();
  const width = useSidebarWidth();
  const setWidth = useSidebarStore((s) => s.setWidth);
  const selectedTabCwd = useSidebarStore((s) => s.selectedTabCwd);
  const setSelectedTabCwd = useSidebarStore((s) => s.setSelectedTabCwd);
  const setLastInteractedArea = useSidebarStore((s) => s.setLastInteractedArea);
  const view = useSidebarStore((s) => s.view);
  const setView = useSidebarStore((s) => s.setView);

  const metas = useTerminalMetaStore((s) => s.metas);
  const activeTerminalId = useActiveTerminalId();
  const { setActiveTerminal } = useTerminalActions();

  // ピン留めディレクトリ (ペインに紐付かない追加ツリー)
  const pinnedPaths = usePinnedDirsStore((s) => s.paths);
  const initPinned = usePinnedDirsStore((s) => s.init);
  const removePinned = usePinnedDirsStore((s) => s.remove);
  const addPinned = usePinnedDirsStore((s) => s.add);

  // 起動時に永続化されたピン留めをロード
  useEffect(() => {
    void initPinned();
  }, [initPinned]);

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

  // ペインメタ + ピン留め CWD からタブを構築
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
    return buildCwdTabs(inputs, pinnedPaths);
  }, [metas, pinnedPaths]);

  // アクティブペインの CWD に対応するタブを自動選択（双方向同期その 1）。
  // 「アクティブペインの id か CWD が実際に変わったとき」だけシンクする。
  // selectedTabCwd を deps に入れると、ユーザーがピン留めタブを手動選択した
  // 直後にこの effect が再発火し、すぐアクティブペインのタブへ巻き戻ってしまう。
  // それを防ぐため、最後にシンクした (id, cwd) を ref で覚え、変化があったときだけ走らせる。
  const lastSyncedActiveRef = useRef<{ id: string | null; cwd: string | null }>(
    { id: null, cwd: null },
  );
  useEffect(() => {
    if (!activeTerminalId) {
      lastSyncedActiveRef.current = { id: null, cwd: null };
      return;
    }
    const activeCwd = metas.get(activeTerminalId)?.cwd ?? null;
    if (!activeCwd) return;
    if (
      lastSyncedActiveRef.current.id === activeTerminalId &&
      lastSyncedActiveRef.current.cwd === activeCwd
    ) {
      // 前回シンク以降アクティブペインは動いていない → ユーザーの手動タブ選択を尊重
      return;
    }
    lastSyncedActiveRef.current = { id: activeTerminalId, cwd: activeCwd };
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
    // pinned-only タブはペインを持たない → setActiveTerminal は呼ばない
    if (
      tab.lastActivePaneId !== null &&
      tab.lastActivePaneId !== activeTerminalId
    ) {
      setActiveTerminal(tab.lastActivePaneId);
    }
  };

  // 「ツリーを追加」: ディレクトリ選択ダイアログ → ピン留め登録
  const handleAddPinnedDir = async (): Promise<void> => {
    const picked = await window.api.dialog.selectDirectory();
    if (!picked) return;
    const ok = await addPinned(picked);
    if (!ok) {
      showErrorToast("ピン留めに失敗しました (既に登録済みか、無効なパス)");
      return;
    }
    setSelectedTabCwd(picked);
  };

  // 既存タブのピン留め切替 (toggle: pinned ↔ unpinned)
  const handleTogglePin = async (tab: CwdTab): Promise<void> => {
    if (tab.pinned) {
      // unpin: pinned-only なら次のタブへフォールバック
      const wasSelected = tab.cwd === selectedTabCwd;
      const ok = await removePinned(tab.cwd);
      if (!ok) {
        showErrorToast("ピン留め解除に失敗しました");
        return;
      }
      if (wasSelected && tab.paneIds.length === 0) {
        // 削除後の最初のタブへ (Sidebar 自身の effect でも補正される)
        const remaining = tabs.filter((t) => t.cwd !== tab.cwd);
        setSelectedTabCwd(remaining[0]?.cwd ?? null);
      }
    } else {
      const ok = await addPinned(tab.cwd);
      if (!ok) showErrorToast("ピン留めに失敗しました");
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
      <SidebarTabs
        tabs={tabs}
        selectedCwd={selectedTabCwd}
        onSelectTab={handleSelectTab}
        onTogglePin={(tab) => void handleTogglePin(tab)}
        onAddPinnedDir={() => void handleAddPinnedDir()}
        view={view}
        onSelectView={setView}
      />
      {tabs.length === 0 && view === "files" && (
        <div
          style={{
            padding: 12,
            fontSize: 11,
            color: theme.colors.textSecondary,
          }}
        >
          ターミナルを起動するか、上の「+
          ツリーを追加」でディレクトリを追加してください
        </div>
      )}
      {view === "files" && selectedTabCwd && (
        <DirectoryTree
          rootPath={selectedTabCwd}
          onRequestEditMarkdown={onRequestEditMarkdown}
        />
      )}
      {view === "git" &&
        (selectedTabCwd ? (
          <GitPanel cwd={selectedTabCwd} />
        ) : (
          <div
            style={{
              padding: 12,
              fontSize: 11,
              color: theme.colors.textSecondary,
            }}
          >
            CWD タブを選択すると、その Git リポジトリの状態を表示します
          </div>
        ))}

      {/* 設定セクション。flexShrink:0 で常に下端に固定。 */}
      {/* DirectoryTree 自身が overflow:auto なので、ツリーが長くなっても */}
      {/* この設定セクションは押し出されず常に可視（position:sticky 同等の効果）。 */}
      {/* 念のため position:sticky bottom:0 も指定し、将来 aside 自体が */}
      {/* スクロールするレイアウト変更にも耐えられるようにしている。 */}
      <SidebarSettingsSection />

      <ResizeHandle containerRef={containerRef} />
    </aside>
  );
};

const SidebarSettingsSection: React.FC = () => {
  const theme = useCurrentTheme();
  const openSettings = useSettingsModalStore((s) => s.open);

  const handleClick = (): void => {
    openSettings();
  };

  return (
    <div
      style={{
        flexShrink: 0,
        position: "sticky",
        bottom: 0,
        backgroundColor: theme.colors.headerBackground,
        borderTop: `1px solid ${theme.colors.border}`,
        padding: "6px 8px",
        zIndex: 1,
      }}
    >
      <button
        type="button"
        onClick={handleClick}
        title="設定 (Cmd+,)"
        aria-label="設定を開く"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          backgroundColor: "transparent",
          color: theme.colors.text,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: 4,
          cursor: "pointer",
          fontSize: 12,
          fontFamily: "inherit",
          textAlign: "left",
          transition: "background-color 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span>設定</span>
      </button>
    </div>
  );
};
