import React, { useEffect, useCallback, useState } from "react";
import {
  useCurrentTheme,
  useThemeConfig,
  useThemeStore,
  updateCustomTheme,
} from "../stores/themeStore";
import { useSettingsModalStore } from "../stores/settingsModalStore";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { ShortcutSettings } from "./settings/ShortcutSettings";
import { WindowSettings } from "./settings/WindowSettings";

type Tab = "appearance" | "shortcuts" | "window";

const TABS: { id: Tab; label: string }[] = [
  { id: "appearance", label: "外観" },
  { id: "shortcuts", label: "ショートカット" },
  { id: "window", label: "ウィンドウ" },
];

// 設定モーダル本体。ShortcutsModal と同じ overlay パターンを踏襲しつつ、
// 左カテゴリリスト + 右タブ内容の 2 カラムレイアウト。
// ESC で閉じる。ただしショートカット録音中は ESC で録音キャンセルを優先する。
export const SettingsModal: React.FC = () => {
  const isOpen = useSettingsModalStore((s) => s.isOpen);
  const close = useSettingsModalStore((s) => s.close);
  const recordingId = useSettingsModalStore((s) => s.recordingShortcutId);
  const overrideTheme = useThemeStore((s) => s.overrideTheme);

  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  const [tab, setTab] = useState<Tab>("appearance");

  // close 系統一: 編集中の override（テーマ draft）を破棄してからモーダルを閉じる。
  // × ボタン / 背景クリック / ESC / 「キャンセル」ボタン全てで使われる。
  const handleCancel = useCallback(() => {
    useThemeStore.getState().setOverrideTheme(null);
    close();
  }, [close]);

  // 「保存」: 編集中の override を customTheme として永続化、override をクリアして閉じる。
  // テーマ以外の設定（Opacity / Vibrancy / ショートカット）は既に即時保存されている。
  const handleSave = useCallback(() => {
    const draft = useThemeStore.getState().overrideTheme;
    if (draft) {
      updateCustomTheme(draft);
      useThemeStore.getState().setOverrideTheme(null);
    }
    close();
  }, [close]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 録音中は ShortcutSettings 側のリスナーが ESC を処理するので、
      // モーダルは閉じない。
      if (recordingId !== null) return;
      handleCancel();
    },
    [handleCancel, recordingId],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      onClick={handleCancel}
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
          width: 800,
          maxWidth: "95vw",
          height: 600,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: theme.colors.headerBackground,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: `${theme.spacing.md} ${theme.spacing.lg}`,
            borderBottom: `1px solid ${theme.colors.border}`,
            flexShrink: 0,
          }}
        >
          <h2
            style={{
              margin: 0,
              color: theme.colors.text,
              fontSize: "16px",
              fontWeight: 600,
            }}
          >
            設定
            {overrideTheme && (
              <span
                style={{
                  marginLeft: theme.spacing.sm,
                  fontSize: "11px",
                  fontWeight: 400,
                  color: theme.colors.accent,
                }}
              >
                ● 未保存の変更
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={handleCancel}
            title="閉じる（変更を破棄）"
            style={{
              background: "none",
              border: "none",
              color: theme.colors.textSecondary,
              cursor: "pointer",
              fontSize: "20px",
              padding: theme.spacing.xs,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* 本体: 左サイドバー + 右コンテンツ */}
        <div
          style={{
            flex: 1,
            display: "flex",
            minHeight: 0,
          }}
        >
          {/* 左カテゴリリスト */}
          <nav
            style={{
              width: 180,
              flexShrink: 0,
              borderRight: `1px solid ${theme.colors.border}`,
              backgroundColor: theme.colors.background,
              overflowY: "auto",
            }}
          >
            {TABS.map((t) => {
              const active = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                    backgroundColor: active
                      ? theme.colors.buttonHover
                      : "transparent",
                    color: active
                      ? theme.colors.text
                      : theme.colors.textSecondary,
                    border: "none",
                    borderLeft: active
                      ? `2px solid ${theme.colors.accent}`
                      : "2px solid transparent",
                    cursor: "pointer",
                    fontSize: "13px",
                    textAlign: "left",
                    transition: "background-color 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor =
                        theme.colors.buttonHover;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>

          {/* 右コンテンツ */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflowY: "auto",
            }}
          >
            {tab === "appearance" && <AppearanceSettings />}
            {tab === "shortcuts" && <ShortcutSettings />}
            {tab === "window" && <WindowSettings />}
          </div>
        </div>

        {/* フッター: 「保存」はテーマ編集の draft を確定する。
           Opacity / Vibrancy / ショートカットは即時保存のため Save ボタンとは独立。 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: theme.spacing.sm,
            padding: `${theme.spacing.md} ${theme.spacing.lg}`,
            borderTop: `1px solid ${theme.colors.border}`,
            flexShrink: 0,
            backgroundColor: theme.colors.background,
          }}
        >
          <span
            style={{
              fontSize: "11px",
              color: theme.colors.textSecondary,
            }}
          >
            {overrideTheme
              ? "外観タブの変更は「保存」で永続化されます。"
              : "ショートカット / ウィンドウは即時保存されます。"}
          </span>
          <div style={{ display: "flex", gap: theme.spacing.sm }}>
            <button
              type="button"
              onClick={handleCancel}
              style={{
                padding: `6px ${theme.spacing.lg}`,
                backgroundColor: "transparent",
                color: theme.colors.text,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.borderRadius,
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!overrideTheme}
              title={
                overrideTheme
                  ? "編集中のテーマを保存"
                  : "保存対象の変更がありません"
              }
              style={{
                padding: `6px ${theme.spacing.lg}`,
                backgroundColor: overrideTheme
                  ? theme.colors.accent
                  : "transparent",
                color: overrideTheme ? "#ffffff" : theme.colors.textSecondary,
                border: `1px solid ${
                  overrideTheme ? theme.colors.accent : theme.colors.border
                }`,
                borderRadius: theme.borderRadius,
                cursor: overrideTheme ? "pointer" : "not-allowed",
                fontSize: "12px",
                opacity: overrideTheme ? 1 : 0.6,
              }}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
