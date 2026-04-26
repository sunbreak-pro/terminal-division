import React, { useCallback, useEffect } from "react";
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";
import { getFileName } from "../utils/markdownFile";

interface OpenMarkdownModalProps {
  isOpen: boolean;
  filePath: string;
  paneNumber: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export const OpenMarkdownModal: React.FC<OpenMarkdownModalProps> = ({
  isOpen,
  filePath,
  paneNumber,
  onConfirm,
  onCancel,
}) => {
  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    },
    [onCancel, onConfirm],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const fileName = getFileName(filePath);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: theme.colors.headerBackground,
          borderRadius: "8px",
          border: `1px solid ${theme.colors.border}`,
          padding: theme.spacing.xl,
          maxWidth: "420px",
          width: "90%",
        }}
      >
        <h2
          style={{
            margin: 0,
            marginBottom: theme.spacing.lg,
            color: theme.colors.text,
            fontSize: "16px",
            fontWeight: 600,
          }}
        >
          Markdown を編集
        </h2>

        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.md,
            color: theme.colors.text,
            fontSize: "14px",
          }}
        >
          <span>ペイン</span>
          <span
            style={{
              color: theme.colors.accent,
              fontSize: "32px",
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            {paneNumber}
          </span>
          <span>で編集します。よろしいですか？</span>
        </div>

        <div
          style={{
            color: theme.colors.textSecondary,
            fontSize: "12px",
            marginBottom: theme.spacing.lg,
            wordBreak: "break-all",
          }}
          title={filePath}
        >
          {fileName}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: theme.spacing.sm,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
              backgroundColor: "transparent",
              color: theme.colors.text,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borderRadius,
              cursor: "pointer",
              fontSize: "13px",
              fontFamily: "inherit",
            }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            style={{
              padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
              backgroundColor: theme.colors.accent,
              color: theme.colors.background,
              border: `1px solid ${theme.colors.accent}`,
              borderRadius: theme.borderRadius,
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              fontFamily: "inherit",
            }}
          >
            はい
          </button>
        </div>
      </div>
    </div>
  );
};
