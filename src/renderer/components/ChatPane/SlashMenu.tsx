import React, { useEffect, useMemo, useRef } from "react";
import { useCurrentTheme } from "../../stores/themeStore";

export interface SlashItem {
  insert: string;
  label: string;
  description: string;
  scope: "global" | "project" | "builtin";
  kind: "command" | "skill";
}

interface SlashMenuProps {
  items: SlashItem[];
  query: string; // 先頭の `/` を含まないクエリ（例: "rev"）
  selectedIndex: number;
  onSelect: (item: SlashItem) => void;
  onHoverIndex: (index: number) => void;
}

/**
 * `/` 入力時に ChatInput の上に浮かぶ候補リスト。
 * - 薄い背景 + 控えめな枠線で「補助」感を出す
 * - 選択中のアイテムはやや強調
 * - クリック / Tab / Enter で挿入（Tab/Enter は親側で処理）
 * - フィルタは props.items に渡す前に親側で実施
 */
const SlashMenu: React.FC<SlashMenuProps> = React.memo(
  ({ items, query, selectedIndex, onSelect, onHoverIndex }) => {
    const currentTheme = useCurrentTheme();
    const colors = currentTheme.colors;
    const listRef = useRef<HTMLDivElement>(null);

    // 選択中アイテムが見えるようスクロール
    useEffect(() => {
      const root = listRef.current;
      if (!root) return;
      const el = root.querySelector<HTMLDivElement>(
        `[data-slash-index="${selectedIndex}"]`,
      );
      if (el) {
        el.scrollIntoView({ block: "nearest" });
      }
    }, [selectedIndex]);

    if (items.length === 0) return null;

    return (
      <div
        ref={listRef}
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          bottom: "100%",
          marginBottom: 6,
          maxHeight: 220,
          overflowY: "auto",
          background: colors.headerBackground,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          boxShadow: "0 6px 20px rgba(0, 0, 0, 0.25)",
          padding: 4,
          zIndex: 10,
          opacity: 0.96,
        }}
      >
        <div
          style={{
            padding: "4px 8px",
            fontSize: 10.5,
            color: colors.textSecondary,
            opacity: 0.7,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>
            {query.length > 0 ? `候補: "/${query}"` : "コマンド / スキル"}
          </span>
          <span>Tab で挿入 / Esc で閉じる</span>
        </div>
        {items.map((item, idx) => (
          <SlashRow
            key={`${item.scope}:${item.label}`}
            item={item}
            index={idx}
            selected={idx === selectedIndex}
            onSelect={onSelect}
            onHover={onHoverIndex}
            colors={colors}
          />
        ))}
      </div>
    );
  },
);

SlashMenu.displayName = "SlashMenu";

interface SlashRowProps {
  item: SlashItem;
  index: number;
  selected: boolean;
  onSelect: (item: SlashItem) => void;
  onHover: (index: number) => void;
  colors: ReturnType<typeof useCurrentTheme>["colors"];
}

const SlashRow: React.FC<SlashRowProps> = React.memo(
  ({ item, index, selected, onSelect, onHover, colors }) => {
    const scopeLabel = useMemo(() => {
      if (item.kind === "command") return "command";
      if (item.scope === "project") return "skill (project)";
      return "skill";
    }, [item.kind, item.scope]);

    return (
      <div
        data-slash-index={index}
        onMouseEnter={() => onHover(index)}
        onMouseDown={(e) => {
          // textarea から focus を奪わないため mousedown 段階で preventDefault
          e.preventDefault();
          onSelect(item);
        }}
        style={{
          padding: "5px 8px",
          borderRadius: 4,
          cursor: "pointer",
          background: selected ? `${colors.accent}22` : "transparent",
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
            fontSize: 12,
            color: selected ? colors.accent : colors.text,
            fontWeight: selected ? 600 : 500,
            flexShrink: 0,
          }}
        >
          {item.label}
        </span>
        <span
          style={{
            fontSize: 10.5,
            color: colors.textSecondary,
            opacity: 0.7,
            flexShrink: 0,
          }}
        >
          {scopeLabel}
        </span>
        {item.description && (
          <span
            style={{
              fontSize: 11,
              color: colors.textSecondary,
              opacity: 0.85,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              minWidth: 0,
            }}
            title={item.description}
          >
            {item.description}
          </span>
        )}
      </div>
    );
  },
);

SlashRow.displayName = "SlashRow";

export { SlashMenu };
