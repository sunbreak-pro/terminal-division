import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import {
  useThemeStore,
  useAvailableThemes,
  addCustomTheme,
  deleteCustomTheme,
} from "../../stores/themeStore";
import { useCustomThemes } from "../../stores/settingsStore";
import { themes as builtInThemes } from "../../styles/theme";
import {
  XTERM_THEME_KEYS,
  type AppColors,
  type Theme,
  type XtermTheme,
} from "../../../shared/theme-types";
import { ColorField } from "./ColorField";

// セマンティック 6 色: ユーザーが直接触るのはこれだけ。
// xterm/AppColors の重複フィールドは onChange 内で同時に更新する。
export type SemanticKey =
  | "background"
  | "foreground"
  | "accent"
  | "textSecondary"
  | "border"
  | "danger";

interface SemanticDef {
  key: SemanticKey;
  label: string;
  description: string;
}

const SEMANTIC_DEFS: SemanticDef[] = [
  {
    key: "background",
    label: "背景",
    description: "ターミナル / アプリ全体の背景",
  },
  {
    key: "foreground",
    label: "前景（テキスト）",
    description: "ターミナル文字色 / 主要テキスト",
  },
  {
    key: "accent",
    label: "アクセント",
    description: "アクティブペイン枠 / カーソル / 選択",
  },
  {
    key: "textSecondary",
    label: "サブテキスト",
    description: "弱め / 補助情報の文字色",
  },
  {
    key: "border",
    label: "ボーダー",
    description: "境界線 / ボタンホバー",
  },
  {
    key: "danger",
    label: "Danger",
    description: "削除 / エラーの強調色",
  },
];

// セマンティック色 → 実フィールドのマッピング。各セマンティックは互いに排他的。
type ThemeUpdate = {
  colors?: Partial<AppColors>;
  xterm?: Partial<XtermTheme>;
};

export function semanticUpdate(key: SemanticKey, value: string): ThemeUpdate {
  switch (key) {
    case "background":
      return {
        colors: {
          background: value,
          headerBackground: value,
          terminalBackground: value,
        },
        xterm: {
          background: value,
          cursorAccent: value,
          selectionForeground: value,
        },
      };
    case "foreground":
      return {
        colors: { text: value },
        xterm: { foreground: value },
      };
    case "accent":
      return {
        colors: {
          accent: value,
          activeTerminal: value,
          borderActive: value,
        },
        xterm: { cursor: value, selectionBackground: value },
      };
    case "textSecondary":
      return { colors: { textSecondary: value } };
    case "border":
      return { colors: { border: value, buttonHover: value } };
    case "danger":
      return { colors: { danger: value } };
  }
}

// 表示用に現在のセマンティック値を抽出（代表フィールドを 1 つ参照）。
export function readSemantic(theme: Theme, key: SemanticKey): string {
  switch (key) {
    case "background":
      return theme.xterm.background;
    case "foreground":
      return theme.xterm.foreground;
    case "accent":
      return theme.colors.accent;
    case "textSecondary":
      return theme.colors.textSecondary;
    case "border":
      return theme.colors.border;
    case "danger":
      return theme.colors.danger;
  }
}

const ANSI_KEYS: (keyof XtermTheme)[] = XTERM_THEME_KEYS.filter(
  (k) =>
    ![
      "background",
      "foreground",
      "cursor",
      "cursorAccent",
      "selectionBackground",
      "selectionForeground",
    ].includes(k),
);

const ANSI_LABELS: Record<string, string> = {
  black: "ANSI Black",
  red: "ANSI Red",
  green: "ANSI Green",
  yellow: "ANSI Yellow",
  blue: "ANSI Blue",
  magenta: "ANSI Magenta",
  cyan: "ANSI Cyan",
  white: "ANSI White",
  brightBlack: "Bright Black",
  brightRed: "Bright Red",
  brightGreen: "Bright Green",
  brightYellow: "Bright Yellow",
  brightBlue: "Bright Blue",
  brightMagenta: "Bright Magenta",
  brightCyan: "Bright Cyan",
  brightWhite: "Bright White",
};

export const AppearanceSettings: React.FC = () => {
  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };

  const setTheme = useThemeStore((s) => s.setTheme);
  const overrideTheme = useThemeStore((s) => s.overrideTheme);
  const setOverride = useThemeStore((s) => s.setOverrideTheme);
  const currentThemeId = useThemeStore((s) => s.currentThemeId);

  const customThemes = useCustomThemes();
  const allThemes = useAvailableThemes();

  // 「現在選択中の ID」がカスタムテーマかどうか。currentTheme.id だと
  // override 経由の id を見てしまうため、ストアの currentThemeId を直接使う。
  const isCustom = useMemo(
    () => customThemes.some((t) => t.id === currentThemeId),
    [customThemes, currentThemeId],
  );

  // editing draft が settings の最新値と差分を持つか（保存ボタンの enable 判定に使える）
  const original = useMemo(
    () => customThemes.find((t) => t.id === currentThemeId),
    [customThemes, currentThemeId],
  );

  // カスタムテーマ選択時、自動的に override を初期化して編集モードに入る。
  // 組込テーマ選択時は override をクリア。currentThemeId 変化に追随。
  useEffect(() => {
    if (isCustom && !overrideTheme && original) {
      setOverride({
        ...original,
        colors: { ...original.colors },
        xterm: { ...original.xterm },
      });
      return;
    }
    if (!isCustom && overrideTheme) {
      setOverride(null);
    }
    // 依存に customThemes / setOverride を入れないことで、編集中の draft 更新で
    // useEffect が再 trigger するのを防ぐ。テーマ切替時のみ反応する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCustom, currentThemeId]);

  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);

  const handleSelectTheme = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setTheme(e.target.value);
    },
    [setTheme],
  );

  const handleDuplicate = useCallback(() => {
    const newId = `custom-${Date.now()}`;
    const copy: Theme = {
      id: newId,
      name: `${currentTheme.name} (Copy)`,
      colors: { ...currentTheme.colors },
      xterm: { ...currentTheme.xterm },
    };
    addCustomTheme(copy);
    setTheme(newId);
    // setTheme が override をクリアするため、useEffect で新規カスタムテーマ用の
    // override が自動的にセットされる（editing 開始）。
  }, [currentTheme, setTheme]);

  const handleDelete = useCallback(() => {
    if (!isCustom) return;
    setOverride(null);
    deleteCustomTheme(currentThemeId);
  }, [isCustom, currentThemeId, setOverride]);

  // 編集系ハンドラはすべて override を更新するだけ。永続化はモーダルの「保存」で。
  const handleRenameCustom = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!overrideTheme) return;
      setOverride({ ...overrideTheme, name: e.target.value });
    },
    [overrideTheme, setOverride],
  );

  // ANSI 16 色は xterm のフィールドを直接更新する（セマンティック対象外）
  const handleAnsiColor = useCallback(
    (key: keyof XtermTheme, value: string) => {
      if (!overrideTheme) return;
      setOverride({
        ...overrideTheme,
        xterm: { ...overrideTheme.xterm, [key]: value },
      });
    },
    [overrideTheme, setOverride],
  );

  // セマンティック 6 色: 代表フィールドだけ受け取り、関連する全フィールドを一括更新する。
  // これにより xterm.background と colors.terminalBackground のような重複が同時に動き、
  // 「片方だけ動いて干渉」のバグが起きない。
  const handleSemanticColor = useCallback(
    (key: SemanticKey, value: string) => {
      if (!overrideTheme) return;
      const update = semanticUpdate(key, value);
      setOverride({
        ...overrideTheme,
        colors: { ...overrideTheme.colors, ...(update.colors ?? {}) },
        xterm: { ...overrideTheme.xterm, ...(update.xterm ?? {}) },
      });
    },
    [overrideTheme, setOverride],
  );

  const handleExport = useCallback(async () => {
    try {
      const json = JSON.stringify(currentTheme, null, 2);
      await navigator.clipboard.writeText(json);
      setExportFeedback("クリップボードにコピーしました");
      window.setTimeout(() => setExportFeedback(null), 2000);
    } catch {
      setExportFeedback("コピーに失敗しました");
      window.setTimeout(() => setExportFeedback(null), 2000);
    }
  }, [currentTheme]);

  const handleImportItermColors = useCallback(async () => {
    setImportFeedback(null);
    // .itermcolors は xterm パートのみ持っているため、AppColors は現在のテーマから流用
    const result = await window.api.settings.importItermColors({
      id: currentTheme.id,
      name: currentTheme.name,
      colors: currentTheme.colors,
      xterm: currentTheme.xterm,
    });
    if (!result.ok) {
      if (!result.canceled) {
        setImportFeedback(`インポート失敗: ${result.error ?? "不明なエラー"}`);
        window.setTimeout(() => setImportFeedback(null), 3000);
      }
      return;
    }
    addCustomTheme(result.theme);
    setTheme(result.theme.id);
    setImportFeedback(`「${result.theme.name}」を追加しました`);
    window.setTimeout(() => setImportFeedback(null), 2000);
  }, [currentTheme, setTheme]);

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
        外観
      </h3>

      <Section title="テーマ">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: theme.spacing.sm,
            flexWrap: "wrap",
          }}
        >
          <select
            value={currentTheme.id}
            onChange={handleSelectTheme}
            style={{
              flex: 1,
              minWidth: 200,
              padding: `4px ${theme.spacing.sm}`,
              backgroundColor: "transparent",
              color: theme.colors.text,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borderRadius,
              fontSize: "13px",
              outline: "none",
            }}
          >
            <optgroup label="組込">
              {Object.values(builtInThemes).map((t) => (
                <option
                  key={t.id}
                  value={t.id}
                  style={{
                    backgroundColor: theme.colors.headerBackground,
                    color: theme.colors.text,
                  }}
                >
                  {t.name}
                </option>
              ))}
            </optgroup>
            {customThemes.length > 0 && (
              <optgroup label="カスタム">
                {customThemes.map((t) => (
                  <option
                    key={t.id}
                    value={t.id}
                    style={{
                      backgroundColor: theme.colors.headerBackground,
                      color: theme.colors.text,
                    }}
                  >
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button
            type="button"
            onClick={handleDuplicate}
            style={primaryButtonStyle(theme)}
            title="現在のテーマを複製してカスタムテーマとして編集"
          >
            複製して編集
          </button>
          {isCustom && (
            <button
              type="button"
              onClick={handleDelete}
              style={dangerButtonStyle(theme)}
              title="このカスタムテーマを削除"
            >
              削除
            </button>
          )}
        </div>
        {!isCustom && (
          <p
            style={{
              margin: 0,
              marginTop: theme.spacing.xs,
              color: theme.colors.textSecondary,
              fontSize: "11px",
            }}
          >
            組込テーマは編集できません。「複製して編集」でカスタムテーマを作成してください。
          </p>
        )}
      </Section>

      <Section title="プレビュー">
        <ThemePreview theme={currentTheme} />
        <p
          style={{
            margin: 0,
            marginTop: theme.spacing.xs,
            color: theme.colors.textSecondary,
            fontSize: "11px",
          }}
        >
          編集中の値が即時反映されます。
        </p>
      </Section>

      {isCustom && (
        <Section title="テーマ名">
          <input
            type="text"
            value={currentTheme.name}
            onChange={handleRenameCustom}
            style={{
              width: "100%",
              padding: `4px ${theme.spacing.sm}`,
              backgroundColor: "transparent",
              color: theme.colors.text,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borderRadius,
              fontSize: "13px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </Section>
      )}

      {isCustom && (
        <Section title="カラー">
          {SEMANTIC_DEFS.map((def) => (
            <ColorField
              key={def.key}
              label={def.label}
              value={readSemantic(currentTheme, def.key)}
              onChange={(v) => handleSemanticColor(def.key, v)}
            />
          ))}
          <p
            style={{
              margin: 0,
              marginTop: theme.spacing.xs,
              color: theme.colors.textSecondary,
              fontSize: "11px",
              lineHeight: 1.5,
            }}
          >
            各色は関連する複数のフィールド（例: 背景 → ターミナル背景 +
            ヘッダー背景 + カーソル文字色）にまとめて反映されます。
          </p>
        </Section>
      )}

      {isCustom && (
        <Accordion title="ANSI 16 色（上級）">
          {ANSI_KEYS.map((key) => (
            <ColorField
              key={key}
              label={ANSI_LABELS[key] ?? key}
              value={currentTheme.xterm[key]}
              onChange={(v) => handleAnsiColor(key, v)}
            />
          ))}
        </Accordion>
      )}

      <Section title="インポート / エクスポート">
        <div
          style={{
            display: "flex",
            gap: theme.spacing.sm,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={handleImportItermColors}
            style={primaryButtonStyle(theme)}
            title=".itermcolors（iTerm2 カラースキーム）をインポート"
          >
            .itermcolors をインポート
          </button>
          <button
            type="button"
            onClick={handleExport}
            style={primaryButtonStyle(theme)}
            title="現在のテーマを JSON としてクリップボードにコピー"
          >
            JSON をコピー
          </button>
        </div>
        {importFeedback && (
          <p
            style={{
              margin: 0,
              marginTop: theme.spacing.xs,
              color: theme.colors.text,
              fontSize: "12px",
            }}
          >
            {importFeedback}
          </p>
        )}
        {exportFeedback && (
          <p
            style={{
              margin: 0,
              marginTop: theme.spacing.xs,
              color: theme.colors.text,
              fontSize: "12px",
            }}
          >
            {exportFeedback}
          </p>
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
          mbadolato/iTerm2-Color-Schemes など 450+
          プリセットを取り込めます（カラーパート以外は現在テーマから流用）。
        </p>
      </Section>

      <p
        style={{
          margin: 0,
          marginTop: theme.spacing.lg,
          color: theme.colors.textSecondary,
          fontSize: "11px",
        }}
      >
        利用可能なテーマ数: {allThemes.length}（組込{" "}
        {Object.keys(builtInThemes).length} + カスタム {customThemes.length}）
      </p>
    </div>
  );
};

// ========== サブコンポーネント ==========

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

const Accordion: React.FC<{
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, defaultOpen = false, children }) => {
  const currentTheme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const theme = { colors: currentTheme.colors, ...themeConfig };
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        marginBottom: theme.spacing.md,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borderRadius,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: `${theme.spacing.sm} ${theme.spacing.md}`,
          backgroundColor: "transparent",
          color: theme.colors.text,
          border: "none",
          cursor: "pointer",
          fontSize: "13px",
          textAlign: "left",
        }}
      >
        <span>{title}</span>
        <span style={{ color: theme.colors.textSecondary, fontSize: "11px" }}>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div
          style={{
            padding: theme.spacing.md,
            paddingTop: 0,
            borderTop: `1px solid ${theme.colors.border}`,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

// プレビュー: HTML/CSS でミニターミナル風表示。実 PTY を使わないので軽量。
const ThemePreview: React.FC<{ theme: Theme }> = ({ theme }) => {
  const ansiSwatches: (keyof XtermTheme)[] = [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "brightBlack",
    "brightRed",
    "brightGreen",
    "brightYellow",
    "brightBlue",
    "brightMagenta",
    "brightCyan",
    "brightWhite",
  ];
  return (
    <div
      style={{
        backgroundColor: theme.xterm.background,
        color: theme.xterm.foreground,
        padding: 12,
        borderRadius: 6,
        fontFamily: "Menlo, monospace",
        fontSize: "12px",
        lineHeight: 1.5,
      }}
    >
      <div>
        <span style={{ color: theme.xterm.brightGreen }}>user@host</span>
        <span style={{ color: theme.xterm.foreground }}>:</span>
        <span style={{ color: theme.xterm.brightBlue }}>~/projects</span>
        <span style={{ color: theme.xterm.foreground }}>$ </span>
        <span>ls -la</span>
      </div>
      <div>
        <span style={{ color: theme.xterm.brightCyan }}>drwxr-xr-x </span>
        <span>4 user staff </span>
        <span style={{ color: theme.xterm.brightBlack }}>128 Apr 26 12:00</span>
        <span> </span>
        <span style={{ color: theme.xterm.brightBlue }}>src</span>
      </div>
      <div>
        <span style={{ color: theme.xterm.foreground }}>-rw-r--r-- </span>
        <span>1 user staff </span>
        <span style={{ color: theme.xterm.brightBlack }}>
          2048 Apr 26 12:00
        </span>
        <span> README.md</span>
      </div>
      <div>
        <span style={{ color: theme.xterm.brightYellow }}>warning:</span>
        <span> sample warning </span>
        <span style={{ color: theme.xterm.brightRed }}>error:</span>
        <span> sample error</span>
      </div>
      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: `1px solid ${theme.xterm.brightBlack}`,
          display: "flex",
          gap: 4,
          flexWrap: "wrap",
        }}
      >
        {ansiSwatches.map((k) => (
          <div
            key={k}
            title={k}
            style={{
              width: 18,
              height: 14,
              backgroundColor: theme.xterm[k],
              borderRadius: 2,
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          />
        ))}
      </div>
    </div>
  );
};

// ========== ボタンスタイル ==========

function primaryButtonStyle(theme: {
  colors: { accent: string; text: string; border: string };
  borderRadius: string;
  spacing: { sm: string; md: string };
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

function dangerButtonStyle(theme: {
  colors: { danger: string };
  borderRadius: string;
  spacing: { md: string };
}): React.CSSProperties {
  return {
    padding: `4px ${theme.spacing.md}`,
    backgroundColor: "transparent",
    color: theme.colors.danger,
    border: `1px solid ${theme.colors.danger}`,
    borderRadius: theme.borderRadius,
    cursor: "pointer",
    fontSize: "12px",
    whiteSpace: "nowrap",
  };
}
