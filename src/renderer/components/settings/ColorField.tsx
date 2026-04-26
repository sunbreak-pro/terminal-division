import React, { useState, useRef, useEffect, useCallback } from "react";
import { HexColorPicker } from "react-colorful";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// 1 行で「ラベル + HEX 入力 + スウォッチ」を表示する共通コンポーネント。
// スウォッチをクリックすると react-colorful のポップオーバーが開く。
// ポップオーバー外クリックで閉じる。
//
// 重要: タイプ中の不完全な値（例: "#ff"）を親に伝播させない。
// 親は settings に書き込むため、無効値が一瞬流れただけで main 側の
// validateTheme がテーマ全体を破棄してしまう（カスタムテーマが消える）。
// このため draft state を内部に持ち、有効な HEX になったときだけ onChange する。
export const ColorField: React.FC<ColorFieldProps> = ({
  label,
  value,
  onChange,
}) => {
  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 親から渡された value を表示しつつ、入力中の不完全な値はローカルで保持する。
  // 親で value が変わったら draft を同期（テーマ切替や別フィールド経由の変更を反映）。
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [open]);

  const isValid = HEX_RE.test(draft);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setDraft(next);
      // 有効な HEX になった時だけ親に通知して永続化する
      if (HEX_RE.test(next)) {
        onChange(next);
      }
    },
    [onChange],
  );

  // HexColorPicker からは常に有効な #rrggbb が来る
  const handlePickerChange = useCallback(
    (next: string) => {
      setDraft(next);
      onChange(next);
    },
    [onChange],
  );

  // 入力欄から focus が外れた時、draft が無効値ならスナップして value に戻す
  // （ユーザーが半端な状態のまま放置するのを防ぐ）
  const handleBlur = useCallback(() => {
    if (!HEX_RE.test(draft)) {
      setDraft(value);
    }
  }, [draft, value]);

  return (
    <div
      ref={wrapRef}
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.sm,
        position: "relative",
        marginBottom: theme.spacing.xs,
      }}
    >
      <span
        style={{
          flex: 1,
          fontSize: "12px",
          color: theme.colors.text,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <input
        type="text"
        value={draft}
        onChange={handleInput}
        onBlur={handleBlur}
        spellCheck={false}
        style={{
          width: 90,
          fontFamily: "monospace",
          fontSize: "12px",
          padding: "2px 6px",
          border: `1px solid ${
            isValid ? theme.colors.border : theme.colors.danger
          }`,
          borderRadius: theme.borderRadius,
          background: "transparent",
          color: theme.colors.text,
          outline: "none",
        }}
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="カラーピッカーを開く"
        style={{
          width: 24,
          height: 24,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.borderRadius,
          background: isValid ? draft : "transparent",
          cursor: "pointer",
          padding: 0,
          flexShrink: 0,
        }}
      />
      {open && (
        <div
          style={{
            position: "absolute",
            top: 30,
            right: 0,
            zIndex: 10001,
            backgroundColor: theme.colors.headerBackground,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.borderRadius,
            padding: theme.spacing.sm,
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
          }}
        >
          <HexColorPicker
            color={isValid ? draft : "#000000"}
            onChange={handlePickerChange}
          />
        </div>
      )}
    </div>
  );
};
