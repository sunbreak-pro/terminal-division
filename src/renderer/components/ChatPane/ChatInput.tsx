import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCurrentTheme } from "../../stores/themeStore";

interface ChatInputProps {
  onSubmit: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

const MAX_INPUT_BYTES = 64 * 1024; // 64KB 警告閾値（送信は許容）
const MIN_ROWS = 1;
const MAX_ROWS = 3;

/**
 * チャット入力欄。Phase 0 plan Q5:
 * - 1〜3 行までは textarea 高さ自動拡張
 * - 4 行以上は固定高さ + 内部スクロール
 * - Enter 送信 / Shift+Enter 改行 / Cmd+Enter 送信
 * - IME 確定中の Enter は誤送信防止
 * - streaming 中は送信ボタンを「停止」に切り替える
 */
const ChatInput: React.FC<ChatInputProps> = React.memo(
  ({ onSubmit, onStop, isStreaming, disabled }) => {
    const currentTheme = useCurrentTheme();
    const colors = currentTheme.colors;
    const [value, setValue] = useState("");
    const [isComposing, setIsComposing] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // textarea 高さを 1〜MAX_ROWS 行で auto-resize する。
    // 4 行以上は max-height で打ち切り、overflow-y: auto で内部スクロールに切替。
    useLayoutEffect(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      // 一旦リセットして scrollHeight を計測
      ta.style.height = "auto";
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      const padding =
        parseFloat(getComputedStyle(ta).paddingTop) +
        parseFloat(getComputedStyle(ta).paddingBottom);
      const maxHeight = lineHeight * MAX_ROWS + padding;
      const minHeight = lineHeight * MIN_ROWS + padding;
      const desired = Math.min(Math.max(ta.scrollHeight, minHeight), maxHeight);
      ta.style.height = `${desired}px`;
      // 4 行以上のときだけ縦スクロール
      ta.style.overflowY = ta.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [value]);

    const handleSubmit = useCallback((): void => {
      const trimmed = value.trim();
      if (trimmed.length === 0) return;
      if (isStreaming) return;
      onSubmit(trimmed);
      setValue("");
    }, [value, isStreaming, onSubmit]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
        // IME 中は Enter / Cmd+Enter を一切処理しない（IME 確定の Enter を保護）
        if (isComposing || e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            handleSubmit();
            return;
          }
          if (e.shiftKey) {
            // 改行: textarea のデフォルト動作に任せる
            return;
          }
          e.preventDefault();
          handleSubmit();
        }
      },
      [handleSubmit, isComposing],
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
        }}
      >
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
            placeholder="メッセージを入力（Enter 送信 / Shift+Enter で改行）"
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
              fontSize: 13.5,
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

export { ChatInput };
