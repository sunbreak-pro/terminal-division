import React, { useState } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import {
  useFileOpsHistoryStore,
  describeOp,
} from "../../stores/fileOpsHistoryStore";
import { undoLast, redoLast } from "../../services/fileOpsService";
import { useFileTreeStore } from "../../stores/fileTreeStore";
import { useSidebarStore } from "../../stores/sidebarStore";
import { UndoIcon, RedoIcon, RefreshIcon } from "./icons";

export const UndoRedoToolbar: React.FC = () => {
  const theme = useCurrentTheme();
  const config = useThemeConfig();
  const undoStack = useFileOpsHistoryStore((s) => s.undoStack);
  const redoStack = useFileOpsHistoryStore((s) => s.redoStack);
  const refreshAllExpanded = useFileTreeStore((s) => s.refreshAllExpanded);
  const selectedTabCwd = useSidebarStore((s) => s.selectedTabCwd);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const canRefresh = !!selectedTabCwd && !isRefreshing;
  const handleRefresh = async (): Promise<void> => {
    if (!selectedTabCwd || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshAllExpanded(selectedTabCwd);
    } finally {
      setIsRefreshing(false);
    }
  };
  const undoTip = canUndo
    ? `元に戻す (${describeOp(undoStack[undoStack.length - 1])})`
    : "元に戻す履歴がありません";
  const redoTip = canRedo
    ? `やり直す (${describeOp(redoStack[redoStack.length - 1])})`
    : "やり直す履歴がありません";

  const baseButtonStyle = (enabled: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 24,
    background: "transparent",
    border: `1px solid ${theme.colors.border}`,
    borderRadius: config.borderRadius,
    color: enabled ? theme.colors.text : theme.colors.textSecondary,
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.5,
    transition: "background-color 0.15s ease",
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: `${config.spacing.xs} ${config.spacing.sm}`,
        borderBottom: `1px solid ${theme.colors.border}`,
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        title={undoTip}
        disabled={!canUndo}
        onClick={() => void undoLast()}
        style={baseButtonStyle(canUndo)}
        onMouseEnter={(e) => {
          if (canUndo)
            e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <UndoIcon size={14} />
      </button>
      <button
        type="button"
        title={redoTip}
        disabled={!canRedo}
        onClick={() => void redoLast()}
        style={baseButtonStyle(canRedo)}
        onMouseEnter={(e) => {
          if (canRedo)
            e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <RedoIcon size={14} />
      </button>
      <button
        type="button"
        title={
          canRefresh
            ? "ツリーを再読み込み (Cmd+R)"
            : "再読み込みできるタブがありません"
        }
        disabled={!canRefresh}
        onClick={() => void handleRefresh()}
        style={baseButtonStyle(canRefresh)}
        onMouseEnter={(e) => {
          if (canRefresh)
            e.currentTarget.style.backgroundColor = theme.colors.buttonHover;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <RefreshIcon size={14} />
      </button>
      <div style={{ flex: 1 }} />
      <span
        style={{
          fontSize: 10,
          color: theme.colors.textSecondary,
        }}
      >
        {undoStack.length > 0 && `${undoStack.length} 件の履歴`}
      </span>
    </div>
  );
};
