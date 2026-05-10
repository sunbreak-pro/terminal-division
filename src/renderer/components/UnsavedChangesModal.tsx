import React, { useCallback, useEffect } from "react";
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";
import { getFileName } from "../utils/markdownFile";

// "open-other": 別 Markdown を開く / 現在のタブを閉じる際の警告。
// "close-pane": 右サイドバー内ペインを閉じる際、未保存タブを巻き込む警告。
export type UnsavedReason = "open-other" | "close-pane";

interface UnsavedChangesModalProps {
  isOpen: boolean;
  filePath: string;
  reason: UnsavedReason;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

function reasonText(reason: UnsavedReason): string {
  switch (reason) {
    case "open-other":
      return "このタブを閉じると、編集中の内容は失われます。";
    case "close-pane":
      return "このペインを閉じると、編集中のタブが失われます。";
  }
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
  isOpen,
  filePath,
  reason,
  onSave,
  onDiscard,
  onCancel,
}) => {
  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    },
    [onCancel],
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
        zIndex: 1001,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: theme.colors.headerBackground,
          borderRadius: "8px",
          border: `1px solid ${theme.colors.border}`,
          padding: theme.spacing.xl,
          maxWidth: "440px",
          width: "90%",
        }}
      >
        <h2
          style={{
            margin: 0,
            marginBottom: theme.spacing.md,
            color: theme.colors.text,
            fontSize: "16px",
            fontWeight: 600,
          }}
        >
          未保存の変更があります
        </h2>

        <div
          style={{
            color: theme.colors.text,
            fontSize: "14px",
            marginBottom: theme.spacing.sm,
            wordBreak: "break-all",
          }}
          title={filePath}
        >
          <strong>{fileName}</strong>
        </div>

        <div
          style={{
            color: theme.colors.textSecondary,
            fontSize: "13px",
            marginBottom: theme.spacing.lg,
            lineHeight: 1.5,
          }}
        >
          {reasonText(reason)}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: theme.spacing.sm,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            autoFocus
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
            onClick={onDiscard}
            style={{
              padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
              backgroundColor: "transparent",
              color: theme.colors.danger,
              border: `1px solid ${theme.colors.danger}`,
              borderRadius: theme.borderRadius,
              cursor: "pointer",
              fontSize: "13px",
              fontFamily: "inherit",
            }}
          >
            破棄して続行
          </button>
          <button
            type="button"
            onClick={onSave}
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
            保存して続行
          </button>
        </div>
      </div>
    </div>
  );
};
