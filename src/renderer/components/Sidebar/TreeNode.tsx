import React, { useCallback, useEffect, useState } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import {
  useFileTreeStore,
  useDirState,
  type FileNode,
} from "../../stores/fileTreeStore";
import { useSidebarStore } from "../../stores/sidebarStore";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderTypeIcon,
  FileTypeIcon,
} from "./icons";
import { showErrorToast } from "./ErrorToast";
import {
  performRename,
  performMove,
  performCopy,
} from "../../services/fileOpsService";
import { isMarkdownPath } from "../../utils/markdownFile";

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  // Markdown ファイルのシングルクリック時に呼ぶ。未指定なら従来通り選択のみ。
  onRequestEditMarkdown?: (filePath: string) => void;
}

export const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  depth,
  onContextMenu,
  onRequestEditMarkdown,
}) => {
  const theme = useCurrentTheme();
  const config = useThemeConfig();

  const isExpanded = useSidebarStore((s) => s.expandedPaths.has(node.path));
  const setExpanded = useSidebarStore((s) => s.setExpanded);
  const isSelected = useSidebarStore((s) => s.selectedNodePath === node.path);
  const setSelectedNodePath = useSidebarStore((s) => s.setSelectedNodePath);
  const editingPath = useSidebarStore((s) => s.editingPath);
  const setEditingPath = useSidebarStore((s) => s.setEditingPath);
  const dirState = useDirState(
    node.isDirectory && isExpanded ? node.path : null,
  );
  const loadDir = useFileTreeStore((s) => s.loadDir);
  const acquireWatch = useFileTreeStore((s) => s.acquireWatch);
  const releaseWatch = useFileTreeStore((s) => s.releaseWatch);

  const isEditing = editingPath === node.path;

  // 展開時に readDir + watch 取得、折りたたみ時に解放
  useEffect(() => {
    if (!node.isDirectory) return;
    if (!isExpanded) return;
    void loadDir(node.path);
    acquireWatch(node.path);
    return () => {
      releaseWatch(node.path);
    };
  }, [
    node.isDirectory,
    isExpanded,
    node.path,
    loadDir,
    acquireWatch,
    releaseWatch,
  ]);

  // fs:change で対応パスのキャッシュを再ロード
  useEffect(() => {
    if (!node.isDirectory || !isExpanded) return;
    const unsub = window.api.fs.onChange(({ watchedPath }) => {
      if (watchedPath === node.path) {
        void loadDir(node.path);
      }
    });
    return unsub;
  }, [node.isDirectory, isExpanded, node.path, loadDir]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedNodePath(node.path);
      // detail >= 2 はダブルクリックの 2 回目以降。トグルを 2 回実行して打ち消し合うのを防ぐ
      if (node.isDirectory && e.detail <= 1) {
        setExpanded(node.path, !isExpanded);
        return;
      }
      // Markdown ファイルはシングルクリックで編集ダイアログ起動
      if (
        !node.isDirectory &&
        e.detail <= 1 &&
        isMarkdownPath(node.path) &&
        onRequestEditMarkdown
      ) {
        onRequestEditMarkdown(node.path);
      }
    },
    [
      node.path,
      node.isDirectory,
      isExpanded,
      setExpanded,
      setSelectedNodePath,
      onRequestEditMarkdown,
    ],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // ディレクトリは handleClick の 1 回目だけがトグルを行うので、ここでは何もしない
      if (node.isDirectory) return;
      // Markdown ファイルはシングルクリック側で既にダイアログを開いているのでスキップ。
      // 「編集する」コンテキストメニュー (パネル) は右クリックで引き続き利用可能。
      if (isMarkdownPath(node.path)) return;
      // それ以外のファイルは従来通りコンテキストメニュー表示
      onContextMenu(e, node);
    },
    [node, onContextMenu],
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

  // ===== D&D: ドラッグソース =====
  // ツリー内ドロップでは React 側で path を読み取れるよう独自 MIME を埋める
  // 加えて OS ネイティブ drag を main 経由で起動し、外部アプリへのドロップも可能にする
  const TD_PATH_MIME = "application/x-td-path";

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.setData(TD_PATH_MIME, node.path);
      e.dataTransfer.setData("text/plain", node.path);
      e.dataTransfer.effectAllowed = "copyMove";
      // OS ネイティブ drag: 外部アプリ(Finder など)へのドロップを有効化
      window.api.dnd.startDrag(node.path);
    },
    [node.path],
  );

  // ===== D&D: ドロップターゲット (ディレクトリのみ) =====
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!node.isDirectory) return;
      e.preventDefault();
      e.stopPropagation();
      const internal = e.dataTransfer.types.includes(TD_PATH_MIME);
      // 内部ドラッグは move、外部 (Finder 等) は copy
      e.dataTransfer.dropEffect = internal ? "move" : "copy";
      if (!isDragOver) setIsDragOver(true);
    },
    [node.isDirectory, isDragOver],
  );

  const handleDragLeave = useCallback(() => {
    if (isDragOver) setIsDragOver(false);
  }, [isDragOver]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!node.isDirectory) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const internalPath = e.dataTransfer.getData(TD_PATH_MIME);
      if (internalPath) {
        // 内部 D&D: 移動
        if (internalPath === node.path) return;
        await performMove(internalPath, node.path);
        return;
      }

      // 外部 (Finder 等) からの取り込み: コピー
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      for (const file of files) {
        const src = window.api.fs.getPathForFile(file);
        if (src && src !== node.path) {
          await performCopy(src, node.path);
        }
      }
    },
    [node.isDirectory, node.path],
  );

  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={node.isDirectory ? isExpanded : undefined}
        aria-selected={isSelected}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        draggable={!isEditing}
        onDragStart={handleDragStart}
        onDragOver={node.isDirectory ? handleDragOver : undefined}
        onDragLeave={node.isDirectory ? handleDragLeave : undefined}
        onDrop={node.isDirectory ? handleDrop : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 6 + depth * 12,
          paddingRight: 6,
          height: 22,
          cursor: "pointer",
          color: theme.colors.text,
          backgroundColor: isDragOver
            ? theme.colors.borderActive
            : isSelected
              ? theme.colors.buttonHover
              : "transparent",
          outline: isDragOver
            ? `1px dashed ${theme.colors.borderActive}`
            : "none",
          fontSize: 12,
          userSelect: "none",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        onMouseEnter={(e) => {
          if (!isSelected && !isDragOver) {
            e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected && !isDragOver) {
            e.currentTarget.style.backgroundColor = "transparent";
          }
        }}
      >
        <span
          style={{
            display: "inline-flex",
            width: 12,
            flexShrink: 0,
            justifyContent: "center",
            color: theme.colors.textSecondary,
          }}
        >
          {node.isDirectory ? (
            isExpanded ? (
              <ChevronDownIcon />
            ) : (
              <ChevronRightIcon />
            )
          ) : null}
        </span>
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
            <FolderTypeIcon name={node.name} expanded={isExpanded} />
          ) : (
            <FileTypeIcon name={node.name} />
          )}
        </span>
        {isEditing ? (
          <RenameInput
            initial={node.name}
            onSubmit={async (next) => {
              setEditingPath(null);
              if (next === node.name || next.length === 0) return;
              await performRename(node.path, next);
            }}
            onCancel={() => setEditingPath(null)}
          />
        ) : (
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
        )}
      </div>

      {node.isDirectory && isExpanded && (
        <ChildList
          dirState={dirState}
          depth={depth + 1}
          onContextMenu={onContextMenu}
          onRequestEditMarkdown={onRequestEditMarkdown}
        />
      )}
    </div>
  );
};

interface ChildListProps {
  dirState: ReturnType<typeof useDirState>;
  depth: number;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onRequestEditMarkdown?: (filePath: string) => void;
}

const ChildList: React.FC<ChildListProps> = ({
  dirState,
  depth,
  onContextMenu,
  onRequestEditMarkdown,
}) => {
  const theme = useCurrentTheme();
  const searchQuery = useSidebarStore((s) => s.searchQuery);
  if (dirState.status === "loading") {
    return (
      <div
        style={{
          paddingLeft: 6 + depth * 12,
          fontSize: 11,
          color: theme.colors.textSecondary,
          padding: "2px 6px",
        }}
      >
        読み込み中…
      </div>
    );
  }
  if (dirState.status === "error") {
    return (
      <div
        style={{
          paddingLeft: 6 + depth * 12,
          fontSize: 11,
          color: theme.colors.danger,
          padding: "2px 6px",
        }}
      >
        {dirState.message}
      </div>
    );
  }
  if (dirState.status !== "ready") return null;
  if (dirState.entries.length === 0) {
    return (
      <div
        style={{
          paddingLeft: 6 + depth * 12,
          fontSize: 11,
          color: theme.colors.textSecondary,
          fontStyle: "italic",
          padding: "2px 6px",
        }}
      >
        （空）
      </div>
    );
  }
  const visible = filterEntriesByQuery(dirState.entries, searchQuery);
  if (visible.length === 0) {
    return (
      <div
        style={{
          paddingLeft: 6 + depth * 12,
          fontSize: 11,
          color: theme.colors.textSecondary,
          fontStyle: "italic",
          padding: "2px 6px",
        }}
      >
        一致なし
      </div>
    );
  }
  return (
    <>
      {visible.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth}
          onContextMenu={onContextMenu}
          onRequestEditMarkdown={onRequestEditMarkdown}
        />
      ))}
    </>
  );
};

export function filterEntriesByQuery(
  entries: FileNode[],
  query: string,
): FileNode[] {
  const trimmed = query.trim();
  if (!trimmed) return entries;
  const q = trimmed.toLowerCase();
  return entries.filter((entry) => entry.name.toLowerCase().includes(q));
}

interface RenameInputProps {
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const RenameInput: React.FC<RenameInputProps> = ({
  initial,
  onSubmit,
  onCancel,
}) => {
  const theme = useCurrentTheme();
  const [value, setValue] = useState(initial);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // 拡張子を除いた範囲だけ選択（よく使う UX）
    const dotIdx = initial.lastIndexOf(".");
    if (dotIdx > 0) {
      el.setSelectionRange(0, dotIdx);
    } else {
      el.select();
    }
  }, [initial]);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSubmit(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else {
          e.stopPropagation();
        }
      }}
      onBlur={() => onSubmit(value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        color: theme.colors.text,
        border: `1px solid ${theme.colors.borderActive}`,
        borderRadius: 2,
        padding: "1px 4px",
        fontSize: 12,
        fontFamily: "inherit",
        minWidth: 0,
      }}
    />
  );
};
