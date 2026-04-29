import React, { useCallback } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import {
  useSettingsStore,
  useTerminalSettings,
} from "../../stores/settingsStore";
import {
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_MAX,
  SCROLLBACK_MIN,
  SCROLLBACK_MAX,
  type CursorStyle,
  type BellStyle,
} from "../../../shared/settings";

// 等幅フォントのプリセット候補。最終的には CSS の font-family にそのまま流すので
// インストールされていないフォントは自動的にフォールバックする。
const FONT_FAMILY_PRESETS: { label: string; value: string }[] = [
  {
    label: "Menlo (既定)",
    value: 'Menlo, Monaco, "Courier New", monospace',
  },
  {
    label: "SF Mono",
    value: '"SF Mono", Menlo, Monaco, monospace',
  },
  {
    label: "JetBrains Mono",
    value: '"JetBrains Mono", Menlo, Monaco, monospace',
  },
  {
    label: "Fira Code",
    value: '"Fira Code", Menlo, Monaco, monospace',
  },
  {
    label: "Hack",
    value: '"Hack", Menlo, Monaco, monospace',
  },
  {
    label: "Source Code Pro",
    value: '"Source Code Pro", Menlo, Monaco, monospace',
  },
];

export const TerminalSettings: React.FC = () => {
  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  const settings = useTerminalSettings();
  const update = useSettingsStore((s) => s.update);

  const setFontSize = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseInt(e.target.value, 10);
      if (!Number.isFinite(v)) return;
      update({ terminal: { fontSize: v } });
    },
    [update],
  );
  const setFontFamily = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      update({ terminal: { fontFamily: e.target.value } });
    },
    [update],
  );
  const setLineHeight = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      update({ terminal: { lineHeight: v } });
    },
    [update],
  );
  const setCursorStyle = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      update({ terminal: { cursorStyle: e.target.value as CursorStyle } });
    },
    [update],
  );
  const setCursorBlink = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      update({ terminal: { cursorBlink: e.target.checked } });
    },
    [update],
  );
  const setScrollback = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseInt(e.target.value, 10);
      if (!Number.isFinite(v)) return;
      update({ terminal: { scrollback: v } });
    },
    [update],
  );
  const setBellStyle = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      update({ terminal: { bellStyle: e.target.value as BellStyle } });
    },
    [update],
  );
  const setWordSeparator = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      update({ terminal: { wordSeparator: e.target.value } });
    },
    [update],
  );
  const setDefaultShell = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      update({ terminal: { defaultShell: e.target.value } });
    },
    [update],
  );
  const setDefaultCwd = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      update({ terminal: { defaultCwd: e.target.value } });
    },
    [update],
  );
  const browseDefaultCwd = useCallback(async () => {
    const dir = await window.api.dialog.selectDirectory();
    if (dir) update({ terminal: { defaultCwd: dir } });
  }, [update]);

  // フォントファミリーがプリセットに該当するかどうか
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
        ターミナル
      </h3>

      <Section title="フォント">
        <Row label={`サイズ: ${settings.fontSize}px`}>
          <input
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={settings.fontSize}
            onChange={setFontSize}
            style={{ flex: 1 }}
          />
        </Row>
        <p
          style={{
            margin: 0,
            marginTop: theme.spacing.xs,
            color: theme.colors.textSecondary,
            fontSize: "11px",
          }}
        >
          Cmd+= / Cmd+- でアクティブペインのみ拡縮、Cmd+0
          でリセット。本設定は新規ペインの初期サイズになります。
        </p>

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
            placeholder='"My Mono", monospace'
            style={inputStyle(theme)}
          />
        </Row>

        <Row label={`行間: ${settings.lineHeight.toFixed(2)}`}>
          <input
            type="range"
            min={LINE_HEIGHT_MIN}
            max={LINE_HEIGHT_MAX}
            step={0.05}
            value={settings.lineHeight}
            onChange={setLineHeight}
            style={{ flex: 1 }}
          />
        </Row>
      </Section>

      <Section title="カーソル">
        <Row label="スタイル">
          <select
            value={settings.cursorStyle}
            onChange={setCursorStyle}
            style={selectStyle(theme)}
          >
            <option value="block" style={optionStyle(theme)}>
              ブロック
            </option>
            <option value="underline" style={optionStyle(theme)}>
              アンダーバー
            </option>
            <option value="bar" style={optionStyle(theme)}>
              縦棒
            </option>
          </select>
        </Row>
        <Row label="点滅">
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
              checked={settings.cursorBlink}
              onChange={setCursorBlink}
            />
            カーソルを点滅させる
          </label>
        </Row>
      </Section>

      <Section title="履歴 / 通知">
        <Row label={`スクロールバック: ${settings.scrollback} 行`}>
          <input
            type="range"
            min={SCROLLBACK_MIN}
            max={SCROLLBACK_MAX}
            step={1000}
            value={settings.scrollback}
            onChange={setScrollback}
            style={{ flex: 1 }}
          />
        </Row>
        <Row label="ベル動作">
          <select
            value={settings.bellStyle}
            onChange={setBellStyle}
            style={selectStyle(theme)}
          >
            <option value="none" style={optionStyle(theme)}>
              無効
            </option>
            <option value="visual" style={optionStyle(theme)}>
              画面フラッシュ
            </option>
            <option value="sound" style={optionStyle(theme)}>
              システムサウンド
            </option>
          </select>
        </Row>
        <p
          style={{
            margin: 0,
            marginTop: theme.spacing.xs,
            color: theme.colors.textSecondary,
            fontSize: "11px",
          }}
        >
          ベルはシェルからの \a (BEL) を受けたときに発火します。Claude Code
          の処理完了通知などで効きます。
        </p>
      </Section>

      <Section title="単語選択">
        <Row label="区切り文字">
          <input
            type="text"
            value={settings.wordSeparator}
            onChange={setWordSeparator}
            style={inputStyle(theme)}
          />
        </Row>
        <p
          style={{
            margin: 0,
            marginTop: theme.spacing.xs,
            color: theme.colors.textSecondary,
            fontSize: "11px",
          }}
        >
          ダブルクリックで「単語」として選択する範囲の境界文字。スペースを含めるとパス全体を一括選択できます。
        </p>
      </Section>

      <Section title="シェル / 起動 CWD">
        <Row label="既定シェル">
          <input
            type="text"
            value={settings.defaultShell}
            onChange={setDefaultShell}
            placeholder="/bin/zsh（空欄で $SHELL）"
            style={inputStyle(theme)}
          />
        </Row>
        <Row label="既定 CWD">
          <input
            type="text"
            value={settings.defaultCwd}
            onChange={setDefaultCwd}
            placeholder="$HOME（空欄で既定）"
            style={inputStyle(theme)}
          />
          <button
            type="button"
            onClick={browseDefaultCwd}
            style={primaryButtonStyle(theme)}
            title="ディレクトリを選択"
          >
            参照
          </button>
        </Row>
        <p
          style={{
            margin: 0,
            marginTop: theme.spacing.xs,
            color: theme.colors.textSecondary,
            fontSize: "11px",
            lineHeight: 1.5,
          }}
        >
          Dock や分割からの CWD 継承が優先されます。空欄の場合は $SHELL / $HOME
          が使われます。
        </p>
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

// ===== スタイル =====

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

function primaryButtonStyle(theme: {
  colors: { accent: string };
  borderRadius: string;
  spacing: { md: string };
}): React.CSSProperties {
  return {
    padding: `4px ${theme.spacing.md}`,
    backgroundColor: theme.colors.accent,
    color: "#ffffff",
    border: "none",
    borderRadius: theme.borderRadius,
    cursor: "pointer",
    fontSize: "12px",
    whiteSpace: "nowrap",
  };
}
