import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useCurrentTheme } from "../../stores/themeStore";
import { useTerminalMetaStore } from "../../stores/terminalMetaStore";
import {
  listMarkdownFilesAcrossPanes,
  type MdFileEntry,
} from "../../utils/mdFileListing";
import { openMarkdownInRightSidebar } from "../../services/markdownOpenService";
import { showErrorToast } from "../Sidebar/ErrorToast";

interface RightSidebarFilePickerProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

const DROPDOWN_WIDTH = 320;
const DROPDOWN_MAX_HEIGHT = 360;
const ITEM_HEIGHT = 26;

// 右サイドバー上部の「+」ボタンから開く Markdown ファイル選択ドロップダウン。
// 既存の MdTabPickerDropdown と同じ UX だがペイン非依存に書き直したもの。
export const RightSidebarFilePicker: React.FC<RightSidebarFilePickerProps> = ({
  anchorEl,
  onClose,
}) => {
  const theme = useCurrentTheme();
  const colors = theme.colors;
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<MdFileEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    const top = r.bottom + 4;
    let left = r.left;
    if (left + DROPDOWN_WIDTH > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - DROPDOWN_WIDTH - 8);
    }
    setPos({ top, left });
  }, [anchorEl]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose, anchorEl]);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    const metas = useTerminalMetaStore.getState().metas;
    void (async () => {
      try {
        const result = await listMarkdownFilesAcrossPanes(metas, query);
        if (canceled) return;
        setEntries(result.entries);
        setTruncated(result.truncated);
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [query]);

  const handleSelect = useCallback(
    (filePath: string) => {
      onClose();
      void openMarkdownInRightSidebar(filePath);
    },
    [onClose],
  );

  const handleSelectFromDialog = useCallback(async () => {
    onClose();
    const result = await window.api.dialog.selectFiles();
    if (!result || result.length === 0) return;
    for (const fp of result) {
      const lower = fp.toLowerCase();
      if (!lower.endsWith(".md") && !lower.endsWith(".markdown")) {
        showErrorToast(`Markdown 以外は開けません: ${fp}`);
        continue;
      }
      await openMarkdownInRightSidebar(fp);
    }
  }, [onClose]);

  const itemStyle: React.CSSProperties = useMemo(
    () => ({
      display: "flex",
      alignItems: "center",
      height: ITEM_HEIGHT,
      padding: "0 10px",
      fontSize: 12,
      color: colors.text,
      cursor: "pointer",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      flexShrink: 0,
      minWidth: 0,
    }),
    [colors.text],
  );

  if (!pos) return null;

  return createPortal(
    <div
      ref={containerRef}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: DROPDOWN_WIDTH,
        maxHeight: DROPDOWN_MAX_HEIGHT,
        background: colors.headerBackground,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      role="listbox"
      aria-label="Markdown ファイルを選択"
    >
      <div
        style={{
          padding: "6px 8px",
          borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ファイル名で検索..."
          style={{
            width: "100%",
            padding: "4px 8px",
            background: colors.background,
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            color: colors.text,
            fontSize: 12,
            outline: "none",
          }}
        />
      </div>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {loading && (
          <div
            style={{
              padding: "8px 10px",
              fontSize: 11.5,
              color: colors.textSecondary,
            }}
          >
            検索中...
          </div>
        )}
        {!loading && entries.length === 0 && (
          <div
            style={{
              padding: "8px 10px",
              fontSize: 11.5,
              color: colors.textSecondary,
            }}
          >
            該当する Markdown ファイルが見つかりません
          </div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.path}
            onMouseDown={(e) => {
              e.preventDefault();
              handleSelect(entry.path);
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = colors.buttonHover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
            style={itemStyle}
            role="option"
            aria-label={entry.path}
            title={entry.path}
          >
            <span
              style={{
                fontWeight: 600,
                marginRight: 8,
                flexShrink: 0,
              }}
            >
              {entry.name}
            </span>
            <span
              style={{
                opacity: 0.65,
                fontSize: 11,
                fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
              }}
            >
              {entry.path}
            </span>
          </div>
        ))}
        {truncated && (
          <div
            style={{
              padding: "4px 10px",
              fontSize: 10.5,
              color: colors.textSecondary,
              opacity: 0.7,
              flexShrink: 0,
            }}
          >
            (50 件まで表示。検索で絞り込んでください)
          </div>
        )}
      </div>
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          void handleSelectFromDialog();
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = colors.buttonHover;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
        style={{
          ...itemStyle,
          borderTop: `1px solid ${colors.border}`,
          color: colors.accent,
          fontWeight: 600,
        }}
        role="option"
        aria-label="ファイルを選択"
      >
        ファイルを選択...
      </div>
    </div>,
    document.body,
  );
};
