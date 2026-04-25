import React, { useEffect, useState, useCallback } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import {
  useFileTreeStore,
  useDirState,
  type FileNode,
} from "../../stores/fileTreeStore";
import { TreeNode } from "./TreeNode";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { showErrorToast } from "./ErrorToast";
import { useSidebarStore } from "../../stores/sidebarStore";
import { useActiveTerminalId } from "../../stores/terminalStore";
import { basenameOf, homeRelativePath } from "../../utils/labelCollision";
import {
  performTrash,
  performMove,
  performCopy,
} from "../../services/fileOpsService";
import { useFileOpsHistoryStore } from "../../stores/fileOpsHistoryStore";

const TD_PATH_MIME = "application/x-td-path";

interface DirectoryTreeProps {
  rootPath: string;
}

export const DirectoryTree: React.FC<DirectoryTreeProps> = ({ rootPath }) => {
  const theme = useCurrentTheme();
  const config = useThemeConfig();
  const dirState = useDirState(rootPath);
  const loadDir = useFileTreeStore((s) => s.loadDir);
  const acquireWatch = useFileTreeStore((s) => s.acquireWatch);
  const releaseWatch = useFileTreeStore((s) => s.releaseWatch);
  const activeTerminalId = useActiveTerminalId();
  const setEditingPath = useSidebarStore((s) => s.setEditingPath);

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
  const displayPath = homeRelativePath(rootPath, homeDir);

  const buildMenuItems = useCallback(
    (node: FileNode): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];
      const relative = homeRelativePath(node.path, homeDir);

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
    [activeTerminalId, setEditingPath, homeDir],
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
        title={rootPath}
        style={{
          padding: `${config.spacing.xs} ${config.spacing.sm}`,
          fontSize: 11,
          color: theme.colors.textSecondary,
          borderBottom: `1px solid ${theme.colors.border}`,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          flexShrink: 0,
        }}
      >
        {basenameOf(rootPath)}{" "}
        <span style={{ opacity: 0.7 }}>· {displayPath}</span>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
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
          dirState.entries.map((entry) => (
            <TreeNode
              key={entry.path}
              node={entry}
              depth={0}
              onContextMenu={handleContextMenu}
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
