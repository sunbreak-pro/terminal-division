import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import {
  useSettingsStore,
  useShortcutBindings,
} from "../../stores/settingsStore";
import { useSettingsModalStore } from "../../stores/settingsModalStore";
import {
  SHORTCUT_DEFINITIONS,
  formatKey,
  parseKey,
  resolveShortcutKey,
  findConflictingIds,
  getDefinition,
  type ShortcutCategory as RegistryCategory,
  type ShortcutDefinition,
  type ShortcutId,
} from "../../shortcuts/registry";

const CATEGORY_ORDER: RegistryCategory[] = [
  "Terminal Management",
  "Sidebar",
  "Navigation",
  "Line Editing",
  "Word Editing",
  "App",
];

interface PendingConflict {
  id: ShortcutId;
  newKey: string;
  conflictingIds: ShortcutId[];
}

export const ShortcutSettings: React.FC = () => {
  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  const bindings = useShortcutBindings();
  const recordingId = useSettingsModalStore((s) => s.recordingShortcutId);
  const startRecording = useSettingsModalStore((s) => s.startRecording);
  const stopRecording = useSettingsModalStore((s) => s.stopRecording);

  const [pending, setPending] = useState<PendingConflict | null>(null);

  // カテゴリ順にグループ化
  const grouped = useMemo(() => {
    const map = new Map<RegistryCategory, ShortcutDefinition[]>();
    for (const def of SHORTCUT_DEFINITIONS) {
      const list = map.get(def.category) ?? [];
      list.push(def);
      map.set(def.category, list);
    }
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      defs: map.get(cat) ?? [],
    })).filter((entry) => entry.defs.length > 0);
  }, []);

  // 録音中のキー入力を捕捉する。capture phase で他のハンドラより先に処理。
  // App.tsx 側は recordingShortcutId が立っている間 dispatch を抑制している。
  useEffect(() => {
    if (!recordingId) return;
    const handler = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        stopRecording();
        return;
      }
      // 修飾キーのみの押下は無視（parseKey が null を返す）
      const key = parseKey(e);
      if (!key) return;

      const conflicts = findConflictingIds(key, bindings, recordingId);
      if (conflicts.length > 0) {
        // 確認バナーを表示し、ユーザーの判断を待つ
        setPending({ id: recordingId, newKey: key, conflictingIds: conflicts });
        stopRecording();
        return;
      }
      // 競合なし → 即時適用
      applyBinding(bindings, recordingId, key);
      stopRecording();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recordingId, bindings, stopRecording]);

  const handleStart = useCallback(
    (id: ShortcutId) => {
      setPending(null);
      startRecording(id);
    },
    [startRecording],
  );

  const handleClear = useCallback(
    (id: ShortcutId) => {
      const next = { ...bindings, [id]: null };
      useSettingsStore.getState().update({ shortcuts: next });
    },
    [bindings],
  );

  const handleResetOne = useCallback(
    (id: ShortcutId) => {
      // settings から ID を取り除けば resolveShortcutKey はデフォルトに戻る
      const next = { ...bindings };
      delete next[id];
      useSettingsStore.getState().update({ shortcuts: next });
    },
    [bindings],
  );

  const handleResetAll = useCallback(() => {
    useSettingsStore.getState().update({ shortcuts: {} });
  }, []);

  const handleAcceptConflict = useCallback(() => {
    if (!pending) return;
    // 競合する他方の ID を null（無効化）に、対象 ID を新キーに
    const next = { ...bindings };
    for (const cid of pending.conflictingIds) {
      next[cid] = null;
    }
    next[pending.id] = pending.newKey;
    useSettingsStore.getState().update({ shortcuts: next });
    setPending(null);
  }, [pending, bindings]);

  const handleCancelConflict = useCallback(() => {
    setPending(null);
  }, []);

  return (
    <div style={{ padding: theme.spacing.lg }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: theme.spacing.md,
        }}
      >
        <h3
          style={{
            margin: 0,
            color: theme.colors.text,
            fontSize: "14px",
            fontWeight: 600,
          }}
        >
          ショートカット
        </h3>
        <button
          type="button"
          onClick={handleResetAll}
          style={{
            padding: `4px ${theme.spacing.md}`,
            backgroundColor: "transparent",
            color: theme.colors.text,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.borderRadius,
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          すべてデフォルトに戻す
        </button>
      </div>

      {pending && (
        <ConflictBanner
          pending={pending}
          onAccept={handleAcceptConflict}
          onCancel={handleCancelConflict}
        />
      )}

      {grouped.map((entry) => (
        <div key={entry.category} style={{ marginBottom: theme.spacing.lg }}>
          <h4
            style={{
              margin: 0,
              marginBottom: theme.spacing.sm,
              color: theme.colors.accent,
              fontSize: "12px",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {entry.category}
          </h4>
          <div
            style={{
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borderRadius,
              overflow: "hidden",
            }}
          >
            {entry.defs.map((def, idx) => {
              const resolved = resolveShortcutKey(def.id, bindings);
              const isOverridden = Object.prototype.hasOwnProperty.call(
                bindings,
                def.id,
              );
              const isRecording = recordingId === def.id;
              return (
                <div
                  key={def.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: theme.spacing.sm,
                    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                    borderBottom:
                      idx < entry.defs.length - 1
                        ? `1px solid ${theme.colors.border}`
                        : "none",
                    backgroundColor: isRecording
                      ? theme.colors.buttonHover
                      : "transparent",
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      color: theme.colors.text,
                      fontSize: "13px",
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {def.label}
                  </div>
                  <div
                    style={{
                      minWidth: 130,
                      padding: `2px ${theme.spacing.sm}`,
                      backgroundColor: theme.colors.headerBackground,
                      border: `1px solid ${theme.colors.border}`,
                      borderRadius: theme.borderRadius,
                      fontSize: "12px",
                      fontFamily: "monospace",
                      color: isRecording
                        ? theme.colors.accent
                        : theme.colors.text,
                      textAlign: "center",
                    }}
                  >
                    {isRecording ? "押すキーを入力..." : formatKey(resolved)}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      isRecording ? stopRecording() : handleStart(def.id)
                    }
                    style={smallButtonStyle(theme)}
                  >
                    {isRecording ? "キャンセル" : "変更"}
                  </button>
                  {isOverridden && (
                    <button
                      type="button"
                      onClick={() => handleResetOne(def.id)}
                      title="デフォルトに戻す"
                      style={smallButtonStyle(theme)}
                    >
                      デフォルト
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleClear(def.id)}
                    title="このショートカットを無効化"
                    style={smallButtonStyle(theme)}
                  >
                    クリア
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <p
        style={{
          margin: 0,
          marginTop: theme.spacing.md,
          color: theme.colors.textSecondary,
          fontSize: "11px",
          lineHeight: 1.6,
        }}
      >
        録音中は ESC でキャンセル。修飾キー単独（Cmd / Shift /
        Option）は無効です。
      </p>
    </div>
  );
};

function applyBinding(
  bindings: Record<string, string | null>,
  id: ShortcutId,
  key: string,
): void {
  const next = { ...bindings, [id]: key };
  useSettingsStore.getState().update({ shortcuts: next });
}

function smallButtonStyle(theme: {
  colors: { text: string; border: string };
  borderRadius: string;
  spacing: { sm: string };
}): React.CSSProperties {
  return {
    padding: `2px ${theme.spacing.sm}`,
    backgroundColor: "transparent",
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius,
    cursor: "pointer",
    fontSize: "11px",
    whiteSpace: "nowrap",
  };
}

const ConflictBanner: React.FC<{
  pending: PendingConflict;
  onAccept: () => void;
  onCancel: () => void;
}> = ({ pending, onAccept, onCancel }) => {
  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  const targetLabel = getDefinition(pending.id)?.label ?? pending.id;
  const conflictLabels = pending.conflictingIds
    .map((id) => getDefinition(id)?.label ?? id)
    .join(" / ");

  return (
    <div
      style={{
        padding: theme.spacing.md,
        marginBottom: theme.spacing.md,
        border: `1px solid ${theme.colors.danger}`,
        borderRadius: theme.borderRadius,
        backgroundColor: "transparent",
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.md,
      }}
    >
      <div
        style={{
          flex: 1,
          color: theme.colors.text,
          fontSize: "12px",
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: theme.colors.danger }}>
          {formatKey(pending.newKey)}
        </strong>
        {" は既に「"}
        {conflictLabels}
        {"」に割り当て済みです。「"}
        {targetLabel}
        {"」に上書きしますか？（既存の割り当ては無効化されます）"}
      </div>
      <button
        type="button"
        onClick={onAccept}
        style={{
          padding: `4px ${theme.spacing.md}`,
          backgroundColor: theme.colors.danger,
          color: "#ffffff",
          border: "none",
          borderRadius: theme.borderRadius,
          cursor: "pointer",
          fontSize: "12px",
          whiteSpace: "nowrap",
        }}
      >
        上書き
      </button>
      <button
        type="button"
        onClick={onCancel}
        style={{
          padding: `4px ${theme.spacing.md}`,
          backgroundColor: "transparent",
          color: theme.colors.text,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.borderRadius,
          cursor: "pointer",
          fontSize: "12px",
          whiteSpace: "nowrap",
        }}
      >
        キャンセル
      </button>
    </div>
  );
};
