import React, { useCallback } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import {
  useSettingsStore,
  useGeneralSettings,
} from "../../stores/settingsStore";

export const GeneralSettings: React.FC = () => {
  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  const settings = useGeneralSettings();
  const update = useSettingsStore((s) => s.update);

  const setRestoreSession = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      update({ general: { restoreSessionOnLaunch: e.target.checked } });
    },
    [update],
  );
  const setExitNotification = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const enabled = e.target.checked;
      update({ general: { ptyExitNotification: enabled } });
      // 初回 ON 時にブラウザ通知の許可を求める。許可されないと通知は出ない。
      if (
        enabled &&
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        void Notification.requestPermission();
      }
    },
    [update],
  );

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
        一般
      </h3>

      <Section title="セッション">
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
            checked={settings.restoreSessionOnLaunch}
            onChange={setRestoreSession}
          />
          起動時にレイアウトと CWD を復元する
        </label>
        <p
          style={{
            margin: 0,
            marginTop: theme.spacing.xs,
            color: theme.colors.textSecondary,
            fontSize: "11px",
            lineHeight: 1.5,
          }}
        >
          OFF
          にすると次回起動時は単一ペインで開始します。実行中プロセスは復元対象外で、レイアウト構造と各ペインの
          CWD のみが対象です。
        </p>
      </Section>

      <Section title="通知">
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
            checked={settings.ptyExitNotification}
            onChange={setExitNotification}
          />
          PTY が異常終了したときに macOS 通知を出す
        </label>
        <p
          style={{
            margin: 0,
            marginTop: theme.spacing.xs,
            color: theme.colors.textSecondary,
            fontSize: "11px",
            lineHeight: 1.5,
          }}
        >
          長時間ジョブやデーモンの異常終了を逃さないための通知。exit code が 0
          以外のときだけ通知し、ベル動作とは独立して動きます。
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
