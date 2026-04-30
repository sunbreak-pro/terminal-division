import React, { useCallback } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import {
  useSettingsStore,
  useGeneralSettings,
} from "../../stores/settingsStore";
import {
  APP_ZOOM_MIN,
  APP_ZOOM_MAX,
  APP_ZOOM_STEP,
  DEFAULT_SETTINGS,
  clampNumber,
} from "../../../shared/settings";

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

  // アプリ全体ズーム: APP_ZOOM_STEP 単位で変動。clamp は settings 側でも掛かるが
  // UI 側でも先に丸めて表示と保存値を一致させる。
  const setAppZoom = useCallback(
    (next: number) => {
      // 浮動小数の累積誤差で 1.0000001 等にならないよう小数 2 桁に丸める
      const rounded = Math.round(next * 100) / 100;
      const clamped = clampNumber(
        rounded,
        APP_ZOOM_MIN,
        APP_ZOOM_MAX,
        DEFAULT_SETTINGS.general.appZoomFactor,
      );
      update({ general: { appZoomFactor: clamped } });
    },
    [update],
  );
  const incZoom = useCallback(
    () => setAppZoom(settings.appZoomFactor + APP_ZOOM_STEP),
    [setAppZoom, settings.appZoomFactor],
  );
  const decZoom = useCallback(
    () => setAppZoom(settings.appZoomFactor - APP_ZOOM_STEP),
    [setAppZoom, settings.appZoomFactor],
  );
  const resetZoom = useCallback(
    () => setAppZoom(DEFAULT_SETTINGS.general.appZoomFactor),
    [setAppZoom],
  );

  const zoomPercent = Math.round(settings.appZoomFactor * 100);
  const zoomBtnStyle: React.CSSProperties = {
    minWidth: 36,
    padding: "4px 10px",
    background: "transparent",
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 12,
    lineHeight: 1,
  };

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

      <Section title="アプリ全体の表示倍率">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: theme.spacing.sm,
            color: theme.colors.text,
            fontSize: 13,
          }}
        >
          <button
            type="button"
            onClick={decZoom}
            disabled={settings.appZoomFactor <= APP_ZOOM_MIN + 1e-6}
            title="縮小"
            style={zoomBtnStyle}
          >
            −
          </button>
          <span
            style={{
              minWidth: 56,
              textAlign: "center",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {zoomPercent}%
          </span>
          <button
            type="button"
            onClick={incZoom}
            disabled={settings.appZoomFactor >= APP_ZOOM_MAX - 1e-6}
            title="拡大"
            style={zoomBtnStyle}
          >
            +
          </button>
          <button
            type="button"
            onClick={resetZoom}
            disabled={
              Math.abs(
                settings.appZoomFactor - DEFAULT_SETTINGS.general.appZoomFactor,
              ) < 1e-6
            }
            title="リセット"
            style={{
              ...zoomBtnStyle,
              minWidth: 60,
              marginLeft: theme.spacing.sm,
            }}
          >
            リセット
          </button>
          <input
            type="range"
            min={APP_ZOOM_MIN}
            max={APP_ZOOM_MAX}
            step={APP_ZOOM_STEP}
            value={settings.appZoomFactor}
            onChange={(e) => setAppZoom(parseFloat(e.target.value))}
            style={{ flex: 1, marginLeft: theme.spacing.md }}
          />
        </div>
        <p
          style={{
            margin: 0,
            marginTop: theme.spacing.xs,
            color: theme.colors.textSecondary,
            fontSize: "11px",
            lineHeight: 1.5,
          }}
        >
          ウィンドウ全体（サイドバー / ヘッダー / ターミナル / エディタ /
          チャット）を一括で拡大・縮小します。{Math.round(APP_ZOOM_MIN * 100)}%
          〜{Math.round(APP_ZOOM_MAX * 100)}%。ターミナル個別のフォントズーム
          (⌘+ / ⌘− / ⌘0) とは独立しており、両方を組み合わせて使えます。
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
