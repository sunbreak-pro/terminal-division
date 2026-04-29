import React, { useCallback, useEffect, useState } from "react";
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";
import { getFileName } from "../utils/markdownFile";
import type { PaneChoice } from "../stores/markdownDialogStore";

// 「新規パネルを作成」を表す sentinel id。markdownOpenService の NEW_PANE_CHOICE と一致。
const NEW_PANE_SENTINEL = "__new__";

interface OpenMarkdownModalProps {
  isOpen: boolean;
  filePath: string;
  availablePanes: PaneChoice[];
  defaultPaneId: string;
  // 「新規パネルを作成」を選択肢に含めるか。
  allowCreateNewPane?: boolean;
  onConfirm: (paneId: string) => void;
  onCancel: () => void;
}

export const OpenMarkdownModal: React.FC<OpenMarkdownModalProps> = ({
  isOpen,
  filePath,
  availablePanes,
  defaultPaneId,
  allowCreateNewPane = false,
  onConfirm,
  onCancel,
}) => {
  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  // ダイアログが開く度に初期選択をリセットする
  const [selectedPaneId, setSelectedPaneId] = useState<string>(defaultPaneId);
  useEffect(() => {
    if (isOpen) setSelectedPaneId(defaultPaneId);
  }, [isOpen, defaultPaneId]);

  const handleConfirm = useCallback(() => {
    onConfirm(selectedPaneId);
  }, [onConfirm, selectedPaneId]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") handleConfirm();
    },
    [onCancel, handleConfirm],
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
            alignItems: "center",
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.md,
            color: theme.colors.text,
            fontSize: "14px",
          }}
        >
          <span>編集パネル:</span>
          <PaneSelect
            availablePanes={availablePanes}
            selectedPaneId={selectedPaneId}
            allowCreateNewPane={allowCreateNewPane}
            onChange={setSelectedPaneId}
            theme={theme}
          />
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
            onClick={handleConfirm}
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

interface PaneSelectProps {
  availablePanes: PaneChoice[];
  selectedPaneId: string;
  allowCreateNewPane: boolean;
  onChange: (paneId: string) => void;
  theme: {
    colors: ReturnType<typeof useCurrentTheme>["colors"];
    spacing: ReturnType<typeof useThemeConfig>["spacing"];
    borderRadius: ReturnType<typeof useThemeConfig>["borderRadius"];
  };
}

// ペイン番号 + 「+ 新規」を選択肢として持つ <select>。
// 「新規」が許容される場合、availablePanes が 0/1 でもセレクト UI を出す。
const PaneSelect: React.FC<PaneSelectProps> = ({
  availablePanes,
  selectedPaneId,
  allowCreateNewPane,
  onChange,
  theme,
}) => {
  // 新規が無効、かつペインが 1 つしかない場合は番号のみ表示
  if (!allowCreateNewPane && availablePanes.length <= 1) {
    const only = availablePanes[0];
    return (
      <span
        style={{
          color: theme.colors.accent,
          fontSize: "16px",
          lineHeight: 1,
        }}
      >
        {only?.paneNumber ?? 1}
      </span>
    );
  }
  return (
    <select
      value={selectedPaneId}
      onChange={(e) => onChange(e.target.value)}
      style={{
        backgroundColor: theme.colors.background,
        color: theme.colors.accent,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borderRadius,
        padding: "4px 8px",
        fontSize: "14px",
        lineHeight: 1.2,
        fontFamily: "inherit",
        cursor: "pointer",
      }}
    >
      {availablePanes.map((p) => (
        <option key={p.paneId} value={p.paneId}>
          パネル {p.paneNumber}
        </option>
      ))}
      {allowCreateNewPane && (
        <option value={NEW_PANE_SENTINEL}>+ 新規パネルを作成</option>
      )}
    </select>
  );
};
