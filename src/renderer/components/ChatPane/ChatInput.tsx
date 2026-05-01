import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCurrentTheme } from "../../stores/themeStore";
import { useChatSettings } from "../../stores/settingsStore";
import { SlashMenu, type SlashItem } from "./SlashMenu";

interface ChatInputProps {
  onSubmit: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  // スラッシュ候補取得のための CWD。空文字なら project スキルは取得しない。
  cwd: string;
}

const MAX_INPUT_BYTES = 64 * 1024; // 64KB 警告閾値（送信は許容）
const MIN_ROWS = 1;
const MAX_ROWS = 3;

/**
 * チャット入力欄。
 * - 1〜3 行までは textarea 高さ自動拡張、4 行以上は固定高さ + 内部スクロール
 * - Enter 送信 / Shift+Enter 改行 / Cmd+Enter 送信
 * - IME 確定中の Enter は誤送信防止
 * - streaming 中は送信ボタンを「停止」に切り替える
 * - `/` 入力で SlashMenu を表示。Tab/Enter で挿入、↑↓ で選択、Esc で閉じる
 */
const ChatInput: React.FC<ChatInputProps> = React.memo(
  ({ onSubmit, onStop, isStreaming, disabled, cwd }) => {
    const currentTheme = useCurrentTheme();
    const colors = currentTheme.colors;
    const chatSettings = useChatSettings();
    const [value, setValue] = useState("");
    const [isComposing, setIsComposing] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // スラッシュ候補
    const [allItems, setAllItems] = useState<SlashItem[]>([]);
    const [slashOpen, setSlashOpen] = useState(false);
    const [slashIndex, setSlashIndex] = useState(0);

    // CWD 変化時に候補をプリフェッチ。失敗は黙って無視（候補が空になるだけ）。
    useEffect(() => {
      let cancelled = false;
      void (async () => {
        try {
          const items = await window.api.chat.listSlashItems(cwd);
          if (!cancelled) setAllItems(items);
        } catch {
          if (!cancelled) setAllItems([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [cwd]);

    // textarea 高さを 1〜MAX_ROWS 行で auto-resize する。
    // fontSize 変更時にも line-height 換算が変わるので依存に含める。
    useLayoutEffect(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.style.height = "auto";
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      const padding =
        parseFloat(getComputedStyle(ta).paddingTop) +
        parseFloat(getComputedStyle(ta).paddingBottom);
      const maxHeight = lineHeight * MAX_ROWS + padding;
      const minHeight = lineHeight * MIN_ROWS + padding;
      const desired = Math.min(Math.max(ta.scrollHeight, minHeight), maxHeight);
      ta.style.height = `${desired}px`;
      ta.style.overflowY = ta.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [value, chatSettings.fontSize]);

    // value 末尾の `/<query>` を抽出。`/` の前は行頭または空白でなければならない（URL 等を巻き込まないため）。
    const slashQuery = useMemo(() => extractSlashQuery(value), [value]);

    // クエリ変化時にメニューの開閉とインデックスを調整
    useEffect(() => {
      if (slashQuery === null) {
        setSlashOpen(false);
        return;
      }
      setSlashOpen(true);
      setSlashIndex(0);
    }, [slashQuery]);

    const filteredItems = useMemo<SlashItem[]>(() => {
      if (slashQuery === null) return [];
      const q = slashQuery.toLowerCase();
      if (q.length === 0) return allItems;
      return allItems.filter((it) => it.label.toLowerCase().includes(q));
    }, [allItems, slashQuery]);

    const insertSlashItem = useCallback(
      (item: SlashItem) => {
        const ta = textareaRef.current;
        if (!ta) return;
        const replaced = replaceSlashAtEnd(value, item.insert);
        setValue(replaced);
        setSlashOpen(false);
        // textarea のキャレットを末尾に
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart =
              textareaRef.current.selectionEnd = replaced.length;
            textareaRef.current.focus();
          }
        });
      },
      [value],
    );

    const handleSubmit = useCallback((): void => {
      const trimmed = value.trim();
      if (trimmed.length === 0) return;
      if (isStreaming) return;
      onSubmit(trimmed);
      setValue("");
      setSlashOpen(false);
    }, [value, isStreaming, onSubmit]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
        // IME 中は一切処理しない
        if (isComposing || e.nativeEvent.isComposing) return;

        // SlashMenu が開いているとき: 上下選択、Tab/Enter で挿入、Esc で閉じる
        if (slashOpen && filteredItems.length > 0) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSlashIndex((i) => (i + 1) % filteredItems.length);
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setSlashIndex(
              (i) => (i - 1 + filteredItems.length) % filteredItems.length,
            );
            return;
          }
          if (e.key === "Tab") {
            e.preventDefault();
            const sel = filteredItems[slashIndex];
            if (sel) insertSlashItem(sel);
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setSlashOpen(false);
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            // メニュー開いている状態の素 Enter は挿入扱い（送信より優先）
            e.preventDefault();
            const sel = filteredItems[slashIndex];
            if (sel) insertSlashItem(sel);
            return;
          }
        }

        if (e.key === "Enter") {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            handleSubmit();
            return;
          }
          if (e.shiftKey) {
            return;
          }
          e.preventDefault();
          handleSubmit();
        }
      },
      [
        handleSubmit,
        isComposing,
        slashOpen,
        filteredItems,
        slashIndex,
        insertSlashItem,
      ],
    );

    const oversize = useMemo(
      () =>
        new Blob([value]).size > MAX_INPUT_BYTES
          ? new Blob([value]).size
          : null,
      [value],
    );

    return (
      <div
        style={{
          padding: "8px 12px 10px",
          borderTop: `1px solid ${colors.border}`,
          background: colors.background,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          position: "relative",
        }}
      >
        {slashOpen && (
          <SlashMenu
            items={filteredItems}
            query={slashQuery ?? ""}
            selectedIndex={slashIndex}
            onSelect={insertSlashItem}
            onHoverIndex={setSlashIndex}
          />
        )}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            background: colors.headerBackground,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: "6px 8px",
          }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            placeholder="メッセージを入力（Enter 送信 / Shift+Enter で改行 / `/` で候補）"
            disabled={disabled}
            rows={1}
            style={{
              flex: 1,
              minWidth: 0,
              resize: "none",
              border: "none",
              outline: "none",
              background: "transparent",
              color: colors.text,
              fontSize: chatSettings.fontSize,
              lineHeight: 1.5,
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
              padding: "4px 4px",
            }}
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              title="停止"
              style={{
                flexShrink: 0,
                background: "transparent",
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: "4px 10px",
                color: colors.text,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={value.trim().length === 0 || disabled}
              title="送信 (Enter)"
              style={{
                flexShrink: 0,
                background: colors.activeTerminal,
                border: "none",
                borderRadius: 6,
                padding: "4px 12px",
                color: colors.text,
                fontSize: 12,
                fontWeight: 600,
                cursor:
                  value.trim().length === 0 || disabled
                    ? "not-allowed"
                    : "pointer",
                opacity: value.trim().length === 0 || disabled ? 0.4 : 1,
              }}
            >
              送信
            </button>
          )}
        </div>
        {oversize && (
          <div
            style={{
              fontSize: 11,
              color: colors.textSecondary,
              opacity: 0.85,
            }}
          >
            入力が大きすぎます ({Math.round(oversize / 1024)} KB) — 表示や送信に
            時間がかかる可能性があります
          </div>
        )}
      </div>
    );
  },
);

ChatInput.displayName = "ChatInput";

// 入力末尾の `/<query>` を抽出する。`/` の前は文字列先頭か空白でなければ null（URL 内 `/` を巻き込まない）。
// 改行を含むクエリは無効。
function extractSlashQuery(value: string): string | null {
  // 末尾から `/` を探す
  const lastSlash = value.lastIndexOf("/");
  if (lastSlash === -1) return null;
  const before = lastSlash === 0 ? "" : value[lastSlash - 1];
  if (before !== "" && !/\s/.test(before)) return null;
  const query = value.slice(lastSlash + 1);
  if (/[\s]/.test(query)) return null;
  return query;
}

// 入力末尾の `/<query>` を `insert` に置き換える。前後の空白は維持。
function replaceSlashAtEnd(value: string, insert: string): string {
  const lastSlash = value.lastIndexOf("/");
  if (lastSlash === -1) return value + insert;
  return value.slice(0, lastSlash) + insert + " ";
}

export { ChatInput };
