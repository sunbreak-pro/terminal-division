import React, { useCallback } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import {
  useSettingsStore,
  useEditorSettings,
} from "../../stores/settingsStore";
import {
  EDITOR_FONT_SIZE_MIN,
  EDITOR_FONT_SIZE_MAX,
} from "../../../shared/settings";

// Markdown エディタ向けのフォントプリセット。比例フォント中心（読みやすさ優先）。
const FONT_FAMILY_PRESETS: { label: string; value: string }[] = [
  {
    label: "システム既定",
    value:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", "Helvetica Neue", Arial, sans-serif',
  },
  {
    label: "Helvetica Neue",
    value: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  {
    label: "Hiragino Sans",
    value: '"Hiragino Sans", "Yu Gothic UI", sans-serif',
  },
  {
    label: "等幅 (Menlo)",
    value: 'Menlo, Monaco, "Courier New", monospace',
  },
  {
    label: "等幅 (JetBrains Mono)",
    value: '"JetBrains Mono", Menlo, Monaco, monospace',
  },
];

export const EditorSettings: React.FC = () => {
  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  const settings = useEditorSettings();
  const update = useSettingsStore((s) => s.update);

  const setFontSize = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      update({ editor: { fontSize: v } });
    },
    [update],
  );
  const setFontFamily = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      update({ editor: { fontFamily: e.target.value } });
    },
    [update],
  );
  const setSoftWrap = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      update({ editor: { softWrap: e.target.checked } });
    },
    [update],
  );

  const matchedPreset = FONT_FAMILY_PRESETS.find(
    (p) => p.value === settings.fontFamily,
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
        Markdown エディタ
      </h3>

      <Section title="フォント">
        <Row label={`サイズ: ${settings.fontSize}px`}>
          <input
            type="range"
            min={EDITOR_FONT_SIZE_MIN}
            max={EDITOR_FONT_SIZE_MAX}
            step={0.5}
            value={settings.fontSize}
            onChange={setFontSize}
            style={{ flex: 1 }}
          />
        </Row>
        <Row label="ファミリー">
          <select
            value={matchedPreset ? matchedPreset.value : "__custom__"}
            onChange={(e) => {
              if (e.target.value === "__custom__") return;
              setFontFamily(e);
            }}
            style={selectStyle(theme)}
          >
            {FONT_FAMILY_PRESETS.map((p) => (
              <option key={p.value} value={p.value} style={optionStyle(theme)}>
                {p.label}
              </option>
            ))}
            {!matchedPreset && (
              <option value="__custom__" style={optionStyle(theme)}>
                カスタム
              </option>
            )}
          </select>
        </Row>
        <Row label="カスタム指定">
          <input
            type="text"
            value={settings.fontFamily}
            onChange={setFontFamily}
            placeholder="フォント名, fallback, ..."
            style={inputStyle(theme)}
          />
        </Row>
      </Section>

      <Section title="表示">
        <Row label="折り返し">
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: theme.spacing.xs,
              cursor: "pointer",
              color: theme.colors.text,
              fontSize: "13px",
            }}
          >
            <input
              type="checkbox"
              checked={settings.softWrap}
              onChange={setSoftWrap}
            />
            ソフトラップを有効にする
          </label>
        </Row>
      </Section>
    </div>
  );
};

// ===== レイアウト =====

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

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => {
  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.md,
        marginBottom: theme.spacing.sm,
      }}
    >
      <span
        style={{
          minWidth: 140,
          fontSize: "12px",
          color: theme.colors.textSecondary,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
};

function inputStyle(theme: {
  colors: { text: string; border: string };
  borderRadius: string;
  spacing: { sm: string };
}): React.CSSProperties {
  return {
    flex: 1,
    padding: `4px ${theme.spacing.sm}`,
    backgroundColor: "transparent",
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius,
    fontSize: "13px",
    outline: "none",
    boxSizing: "border-box",
  };
}

function selectStyle(theme: {
  colors: { text: string; border: string };
  borderRadius: string;
  spacing: { sm: string };
}): React.CSSProperties {
  return {
    flex: 1,
    padding: `4px ${theme.spacing.sm}`,
    backgroundColor: "transparent",
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius,
    fontSize: "13px",
    outline: "none",
  };
}

function optionStyle(theme: {
  colors: { headerBackground: string; text: string };
}): React.CSSProperties {
  return {
    backgroundColor: theme.colors.headerBackground,
    color: theme.colors.text,
  };
}
