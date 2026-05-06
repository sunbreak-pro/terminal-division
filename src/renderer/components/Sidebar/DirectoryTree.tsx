import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import {
  useFileTreeStore,
  useDirState,
  type FileNode,
} from "../../stores/fileTreeStore";
import { TreeNode, filterEntriesByQuery } from "./TreeNode";
import { FolderTypeIcon, FileTypeIcon } from "./icons";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { showErrorToast } from "./ErrorToast";
import { useSidebarStore } from "../../stores/sidebarStore";
import { useActiveTerminalId } from "../../stores/terminalStore";
import { useTerminalMetaStore } from "../../stores/terminalMetaStore";
import {
  basenameOf,
  homeRelativePath,
  terminalRelativePath,
} from "../../utils/labelCollision";
import {
  performTrash,
  performMove,
  performCopy,
} from "../../services/fileOpsService";
import { useFileOpsHistoryStore } from "../../stores/fileOpsHistoryStore";
import { isMarkdownPath } from "../../utils/markdownFile";

const TD_PATH_MIME = "application/x-td-path";

interface DirectoryTreeProps {
  rootPath: string;
  // .md / .markdown ファイルのコンテキストメニュー「編集する」が押された際の通知。
  // 親 (Sidebar → App) で確認モーダル → ペインへ反映する流れに使う。
  onRequestEditMarkdown?: (filePath: string) => void;
}

export const DirectoryTree: React.FC<DirectoryTreeProps> = ({
  rootPath,
  onRequestEditMarkdown,
}) => {
  const theme = useCurrentTheme();
  const config = useThemeConfig();
  const dirState = useDirState(rootPath);
  const loadDir = useFileTreeStore((s) => s.loadDir);
  const acquireWatch = useFileTreeStore((s) => s.acquireWatch);
  const releaseWatch = useFileTreeStore((s) => s.releaseWatch);
  const activeTerminalId = useActiveTerminalId();
  const activeCwd = useTerminalMetaStore((s) =>
    activeTerminalId ? (s.metas.get(activeTerminalId)?.cwd ?? null) : null,
  );
  const setEditingPath = useSidebarStore((s) => s.setEditingPath);
  const searchQuery = useSidebarStore((s) => s.searchQuery);
  const setSearchQuery = useSidebarStore((s) => s.setSearchQuery);

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    node: FileNode;
  } | null>(null);

  // ルートディレクトリは常にロード + watch
  useEffect(() => {
    void loadDir(rootPath);
    acquireWatch(rootPath);
    return () => {
      releaseWatch(rootPath);
    };
  }, [rootPath, loadDir, acquireWatch, releaseWatch]);

  useEffect(() => {
    const unsub = window.api.fs.onChange(({ watchedPath }) => {
      if (watchedPath === rootPath) {
        void loadDir(rootPath);
      }
    });
    return unsub;
  }, [rootPath, loadDir]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: FileNode) => {
      setMenu({ x: e.clientX, y: e.clientY, node });
    },
    [],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const homeDir = window.api.system.getHomeDir();

  const visibleEntries = useMemo(
    () =>
      dirState.status === "ready"
        ? filterEntriesByQuery(dirState.entries, searchQuery)
        : [],
    [dirState, searchQuery],
  );

  // ===== 再帰検索 =====
  // searchQuery が非空のときは、サブディレクトリも含めてルート配下を再帰探索した
  // フラットな結果リストをツリーの代わりに表示する。150ms デバウンスで連続入力時の
  // IPC 呼び出しを抑制する。
  type SearchState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; entries: FileNode[]; truncated: boolean }
    | { status: "error"; message: string };
  const [searchState, setSearchState] = useState<SearchState>({
    status: "idle",
  });
  const trimmedQuery = searchQuery.trim();
  const isSearching = trimmedQuery.length > 0;
  useEffect(() => {
    if (!isSearching) {
      setSearchState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setSearchState({ status: "loading" });
    const timer = window.setTimeout(() => {
      void window.api.fs.searchTree(rootPath, trimmedQuery).then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setSearchState({
            status: "ready",
            entries: res.entries,
            truncated: res.truncated,
          });
        } else {
          setSearchState({ status: "error", message: res.error });
        }
      });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [rootPath, trimmedQuery, isSearching]);

  const buildMenuItems = useCallback(
    (node: FileNode): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];
      // 「相対パス」はアクティブなターミナルの CWD 起点。CWD 不明時はホーム起点にフォールバック。
      const relative = activeCwd
        ? terminalRelativePath(node.path, activeCwd)
        : homeRelativePath(node.path, homeDir);

      // ===== セクション 1: パスコピー =====
      items.push({
        label: `相対パスをコピー: ${relative}`,
        onClick: () => {
          void navigator.clipboard
            .writeText(relative)
            .catch(() =>
              showErrorToast("クリップボードへのコピーに失敗しました"),
            );
        },
      });
      items.push({
        label: `フルパスをコピー: ${node.path}`,
        onClick: () => {
          void navigator.clipboard
            .writeText(node.path)
            .catch(() =>
              showErrorToast("クリップボードへのコピーに失敗しました"),
            );
        },
      });

      // ===== セクション 2: 開く / 移動 =====
      if (node.isDirectory) {
        items.push({
          label: "そのディレクトリに移動",
          separatorBefore: true,
          onClick: () => {
            if (!activeTerminalId) {
              showErrorToast("アクティブなターミナルがありません");
              return;
            }
            const escaped = node.path.replace(/'/g, "'\\''");
            window.api.pty.write(activeTerminalId, `cd '${escaped}'\n`);
          },
        });
      }
      items.push({
        label: "VSCode で開く",
        separatorBefore: !node.isDirectory,
        onClick: () => {
          void window.api.fs.openInVSCode(node.path).then((res) => {
            if (!res.ok) {
              showErrorToast(
                "VSCode を起動できませんでした（`code` コマンドが PATH にありますか？）",
              );
            }
          });
        },
      });

      // .md / .markdown だけアプリ内エディタで開く選択肢を表示。
      // それ以外の拡張子では項目自体を出さない（コンテキストメニュー肥大化を避ける）。
      if (!node.isDirectory && isMarkdownPath(node.path)) {
        items.push({
          label: "編集する",
          onClick: () => {
            if (onRequestEditMarkdown) {
              onRequestEditMarkdown(node.path);
            }
          },
        });
      }

      // ===== セクション 3: 編集 =====
      items.push({
        label: "名称変更",
        separatorBefore: true,
        onClick: () => {
          setEditingPath(node.path);
        },
      });
      items.push({
        label: "移動…",
        onClick: () => {
          void window.api.fs.moveToDir(node.path).then((res) => {
            if (res.ok) {
              // ダイアログ経由の移動も undo 履歴に積む
              useFileOpsHistoryStore.getState().pushOp({
                kind: "move",
                from: node.path,
                to: res.newPath,
              });
            } else if (!res.canceled) {
              showErrorToast(
                `移動に失敗しました: ${res.error ?? "unknown error"}`,
              );
            }
          });
        },
      });
      items.push({
        label: "削除（ゴミ箱へ）",
        danger: true,
        separatorBefore: true,
        onClick: () => {
          void performTrash(node.path);
        },
      });
      return items;
    },
    [
      activeTerminalId,
      activeCwd,
      setEditingPath,
      homeDir,
      onRequestEditMarkdown,
    ],
  );

  // ルートディレクトリへの D&D ドロップ
  const [rootDragOver, setRootDragOver] = useState(false);
  const handleRootDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const internal = e.dataTransfer.types.includes(TD_PATH_MIME);
      e.dataTransfer.dropEffect = internal ? "move" : "copy";
      if (!rootDragOver) setRootDragOver(true);
    },
    [rootDragOver],
  );
  const handleRootDragLeave = useCallback(() => {
    if (rootDragOver) setRootDragOver(false);
  }, [rootDragOver]);
  const handleRootDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setRootDragOver(false);
      const internalPath = e.dataTransfer.getData(TD_PATH_MIME);
      if (internalPath) {
        if (internalPath === rootPath) return;
        // 既にこのルート直下にあれば何もしない
        const expectedDest = `${rootPath}/${basenameOf(internalPath)}`;
        if (internalPath === expectedDest) return;
        await performMove(internalPath, rootPath);
        return;
      }
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        const src = window.api.fs.getPathForFile(file);
        if (src) await performCopy(src, rootPath);
      }
    },
    [rootPath],
  );

  return (
    <div
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        outline: rootDragOver
          ? `2px dashed ${theme.colors.borderActive}`
          : "none",
        outlineOffset: -2,
      }}
    >
      <div
        style={{
          padding: `${config.spacing.sm} ${config.spacing.sm}`,
          borderBottom: `1px solid ${theme.colors.border}`,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          minHeight: 36,
          boxSizing: "border-box",
        }}
      >
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ファイル名で検索"
          aria-label="ファイル名で検索"
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 0,
            backgroundColor: theme.colors.background,
            color: theme.colors.text,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: 4,
            padding: "5px 8px",
            fontSize: 12,
            fontFamily: "inherit",
            outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = theme.colors.borderActive;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = theme.colors.border;
          }}
        />
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
        {isSearching ? (
          <SearchResultsPanel
            state={searchState}
            rootPath={rootPath}
            onContextMenu={handleContextMenu}
            onRequestEditMarkdown={onRequestEditMarkdown}
          />
        ) : (
          <>
            {dirState.status === "loading" && (
              <div
                style={{
                  padding: config.spacing.sm,
                  fontSize: 11,
                  color: theme.colors.textSecondary,
                }}
              >
                読み込み中…
              </div>
            )}
            {dirState.status === "error" && (
              <div
                style={{
                  padding: config.spacing.sm,
                  fontSize: 11,
                  color: theme.colors.danger,
                }}
              >
                {dirState.message}
              </div>
            )}
            {dirState.status === "ready" &&
              visibleEntries.map((entry) => (
                <TreeNode
                  key={entry.path}
                  node={entry}
                  depth={0}
                  onContextMenu={handleContextMenu}
                  onRequestEditMarkdown={onRequestEditMarkdown}
                />
              ))}
            {dirState.status === "ready" && dirState.entries.length === 0 && (
              <div
                style={{
                  padding: config.spacing.sm,
                  fontSize: 11,
                  color: theme.colors.textSecondary,
                  fontStyle: "italic",
                }}
              >
                （空のディレクトリ）
              </div>
            )}
          </>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems(menu.node)}
          onClose={closeMenu}
        />
      )}
    </div>
  );
};

// ===== 検索結果リスト =====
// 検索クエリ入力時にツリーの代わりに表示するフラットな結果リスト。各行は
// クリックで選択、.md ファイルはシングルクリックで Markdown エディタを起動、
// 右クリックで既存のコンテキストメニューを表示する。
type SearchPanelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; entries: FileNode[]; truncated: boolean }
  | { status: "error"; message: string };

interface SearchResultsPanelProps {
  state: SearchPanelState;
  rootPath: string;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onRequestEditMarkdown?: (filePath: string) => void;
}

const SearchResultsPanel: React.FC<SearchResultsPanelProps> = ({
  state,
  rootPath,
  onContextMenu,
  onRequestEditMarkdown,
}) => {
  const theme = useCurrentTheme();
  const config = useThemeConfig();

  if (state.status === "loading") {
    return (
      <div
        style={{
          padding: config.spacing.sm,
          fontSize: 11,
          color: theme.colors.textSecondary,
        }}
      >
        検索中…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div
        style={{
          padding: config.spacing.sm,
          fontSize: 11,
          color: theme.colors.danger,
        }}
      >
        {state.message}
      </div>
    );
  }
  if (state.status !== "ready") return null;

  if (state.entries.length === 0) {
    return (
      <div
        style={{
          padding: config.spacing.sm,
          fontSize: 11,
          color: theme.colors.textSecondary,
          fontStyle: "italic",
        }}
      >
        一致するファイルがありません
      </div>
    );
  }

  return (
    <>
      {state.entries.map((entry) => (
        <SearchResultRow
          key={entry.path}
          node={entry}
          rootPath={rootPath}
          onContextMenu={onContextMenu}
          onRequestEditMarkdown={onRequestEditMarkdown}
        />
      ))}
      {state.truncated && (
        <div
          style={{
            padding: config.spacing.sm,
            fontSize: 11,
            color: theme.colors.textSecondary,
            fontStyle: "italic",
          }}
        >
          結果が多すぎるため上限で打ち切りました（クエリを絞り込んでください）
        </div>
      )}
    </>
  );
};

interface SearchResultRowProps {
  node: FileNode;
  rootPath: string;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onRequestEditMarkdown?: (filePath: string) => void;
}

const SearchResultRow: React.FC<SearchResultRowProps> = ({
  node,
  rootPath,
  onContextMenu,
  onRequestEditMarkdown,
}) => {
  const theme = useCurrentTheme();
  const isSelected = useSidebarStore((s) => s.selectedNodePath === node.path);
  const setSelectedNodePath = useSidebarStore((s) => s.setSelectedNodePath);

  // ルートからの相対パスを 2 行目に表示（ファイル名 + 親ディレクトリの可視化）
  const relativeDir = useMemo(() => {
    const prefix = rootPath.endsWith("/") ? rootPath : rootPath + "/";
    if (!node.path.startsWith(prefix)) return "";
    const rel = node.path.slice(prefix.length);
    const lastSlash = rel.lastIndexOf("/");
    return lastSlash >= 0 ? rel.slice(0, lastSlash) : "";
  }, [node.path, rootPath]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedNodePath(node.path);
      if (
        !node.isDirectory &&
        e.detail <= 1 &&
        isMarkdownPath(node.path) &&
        onRequestEditMarkdown
      ) {
        onRequestEditMarkdown(node.path);
      }
    },
    [node.path, node.isDirectory, setSelectedNodePath, onRequestEditMarkdown],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedNodePath(node.path);
      onContextMenu(e, node);
    },
    [node, setSelectedNodePath, onContextMenu],
  );

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 6px",
        cursor: "pointer",
        color: theme.colors.text,
        backgroundColor: isSelected ? theme.colors.buttonHover : "transparent",
        fontSize: 12,
        userSelect: "none",
        minHeight: 22,
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = "transparent";
        }
      }}
    >
      <span
        style={{
          display: "inline-flex",
          width: 14,
          flexShrink: 0,
          justifyContent: "center",
          color: theme.colors.textSecondary,
        }}
      >
        {node.isDirectory ? (
          <FolderTypeIcon name={node.name} />
        ) : (
          <FileTypeIcon name={node.name} />
        )}
      </span>
      <div
        style={{
          minWidth: 0,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          lineHeight: 1.2,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontStyle: node.isSymlink ? "italic" : "normal",
          }}
        >
          {node.name}
        </span>
        {relativeDir && (
          <span
            style={{
              fontSize: 10,
              color: theme.colors.textSecondary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {relativeDir}
          </span>
        )}
      </div>
    </div>
  );
};
