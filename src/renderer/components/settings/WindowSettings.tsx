import React, { useCallback, useState } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import {
  useSettingsStore,
  useWindowSettings,
} from "../../stores/settingsStore";
import { OPACITY_MIN, OPACITY_MAX } from "../../../shared/settings";

export const WindowSettings: React.FC = () => {
  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  const windowSettings = useWindowSettings();
  // 起動時は settings.window.vibrancyEnabled が反映済みの状態。
  // トグル後の値が起動時値と異なれば「再起動が必要」を表示する。
  const [initialVibrancy] = useState(windowSettings.vibrancyEnabled);
  const vibrancyChanged = windowSettings.vibrancyEnabled !== initialVibrancy;

  const handleOpacityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      // 即時反映（再起動不要）+ 永続化
      window.api.window.setOpacity(v);
      useSettingsStore.getState().update({ window: { opacity: v } });
    },
    [],
  );

  const handleVibrancyToggle = useCallback(() => {
    useSettingsStore.getState().update({
      window: { vibrancyEnabled: !windowSettings.vibrancyEnabled },
    });
  }, [windowSettings.vibrancyEnabled]);

  const handleRelaunch = useCallback(() => {
    if (typeof window !== "undefined" && window.api?.app) {
      window.api.app.relaunch();
    }
  }, []);

  return (
    <div style={{ padding: theme.spacing.lg }}>
      <h3
        style={{
          margin: 0,
          marginBottom: theme.spacing.md,
          color: theme.colors.text,
          fontSize: "14px",
          fontWeight: 600,
        }}
      >
        ウィンドウ
      </h3>

      <Section title="不透明度">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: theme.spacing.md,
          }}
        >
          <input
            type="range"
            min={OPACITY_MIN}
            max={OPACITY_MAX}
            step={0.01}
            value={windowSettings.opacity}
            onChange={handleOpacityChange}
            style={{ flex: 1 }}
          />
          <span
            style={{
              minWidth: 50,
              textAlign: "right",
              color: theme.colors.text,
              fontFamily: "monospace",
              fontSize: "12px",
            }}
          >
            {Math.round(windowSettings.opacity * 100)}%
          </span>
        </div>
        <p
          style={{
            margin: 0,
            marginTop: theme.spacing.xs,
            color: theme.colors.textSecondary,
            fontSize: "11px",
          }}
        >
          スライダー操作で即座にウィンドウへ反映されます（再起動不要）。
        </p>
      </Section>

      <Section title="ウィンドウ透過効果（vibrancy）">
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: theme.spacing.sm,
            cursor: "pointer",
            color: theme.colors.text,
            fontSize: "13px",
          }}
        >
          <input
            type="checkbox"
            checked={windowSettings.vibrancyEnabled}
            onChange={handleVibrancyToggle}
          />
          すりガラス効果を有効にする（macOS のみ）
        </label>
        {vibrancyChanged && (
          <div
            style={{
              marginTop: theme.spacing.sm,
              padding: theme.spacing.sm,
              border: `1px solid ${theme.colors.accent}`,
              borderRadius: theme.borderRadius,
              backgroundColor: "transparent",
              fontSize: "12px",
              color: theme.colors.text,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: theme.spacing.sm,
            }}
          >
            <span>変更を反映するにはアプリの再起動が必要です。</span>
            <button
              type="button"
              onClick={handleRelaunch}
              style={{
                padding: `4px ${theme.spacing.md}`,
                backgroundColor: theme.colors.accent,
                color: "#ffffff",
                border: "none",
                borderRadius: theme.borderRadius,
                cursor: "pointer",
                fontSize: "12px",
                whiteSpace: "nowrap",
              }}
            >
              今すぐ再起動
            </button>
          </div>
        )}
        <p
          style={{
            margin: 0,
            marginTop: theme.spacing.xs,
            color: theme.colors.textSecondary,
            fontSize: "11px",
            lineHeight: 1.5,
          }}
        >
          一部の環境で背景が白く表示される、起動直後に効果が消える等の既知の問題があります（Electron
          #31862）。
        </p>
      </Section>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => {
  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };
  return (
    <div style={{ marginBottom: theme.spacing.lg }}>
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
        {title}
      </h4>
      {children}
    </div>
  );
};
