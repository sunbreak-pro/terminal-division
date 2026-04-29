import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";
import {
  useTerminalMetaStore,
  useTerminalMeta,
  type MdTab,
} from "../stores/terminalMetaStore";
import { useTerminalActions } from "../stores/terminalStore";
import { useEditorSettings } from "../stores/settingsStore";
import { showErrorToast } from "./Sidebar/ErrorToast";
import * as markdownEditorRegistry from "../services/markdownEditorRegistry";
import { withAlpha, isLightBackground } from "../utils/colorUtils";

interface MarkdownEditorProps {
  paneId: string;
  tabId: string;
}

// 親 (TerminalPane) は tab.loadedAt 変化時に key で remount すること。
// これにより value/initialContent の同期問題を避け、CodeMirror の internal state は
// タブ単位でフレッシュに保たれる。
export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  paneId,
  tabId,
}) => {
  const meta = useTerminalMeta(paneId);
  const tab: MdTab | null = useMemo(
    () => meta?.mdTabs.find((t) => t.id === tabId) ?? null,
    [meta, tabId],
  );
  const filePath = tab?.filePath ?? null;
  const savedContent = tab?.savedContent ?? "";

  // 初期 value は mount 時に固定（後続の savedContent 変化で value を入れ替えない）
  const [initialValue] = useState(() => savedContent);

  // セッション復元直後など savedContent="" のままで mount された場合は、ファイルを
  // IPC で読み込んで markMdSaved → 編集開始時の比較基準にする。
  useEffect(() => {
    if (!filePath) return;
    if (tab?.savedContent !== "") return;
    let canceled = false;
    void (async () => {
      const result = await window.api.fs.readFile(filePath);
      if (canceled) return;
      if (!result.ok) {
        showErrorToast(`ファイルを読み込めませんでした: ${result.error}`);
        return;
      }
      // 読み込み内容で savedContent を更新する。dirty=false なので markMdSaved を流用。
      useTerminalMetaStore
        .getState()
        .markMdSaved(paneId, tabId, result.content);
    })();
    return () => {
      canceled = true;
    };
    // mount 時の 1 度だけでよい（後続の savedContent 変化でも再読込しない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const theme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const { setActiveTerminal } = useTerminalActions();
  const editorSettings = useEditorSettings();

  const cmRef = useRef<ReactCodeMirrorRef | null>(null);

  const handleSave = useCallback(async (): Promise<boolean> => {
    const view = cmRef.current?.view;
    if (!view || !filePath) return false;
    const content = view.state.doc.toString();
    const result = await window.api.fs.writeFile(filePath, content);
    if (!result.ok) {
      showErrorToast(`保存に失敗しました: ${result.error}`);
      return false;
    }
    useTerminalMetaStore.getState().markMdSaved(paneId, tabId, content);
    return true;
  }, [paneId, tabId, filePath]);

  // ペイン外部から save / focus を呼ぶための imperative API を registry に登録（tabId キー）
  useEffect(() => {
    markdownEditorRegistry.register(tabId, {
      getContent: () => cmRef.current?.view?.state.doc.toString() ?? "",
      save: handleSave,
      focus: () => cmRef.current?.view?.focus(),
    });
    return () => markdownEditorRegistry.unregister(tabId);
  }, [tabId, handleSave]);

  // 入力のたびに dirty 判定を更新（tab.savedContent と一致なら dirty=false に戻す）
  const handleChange = useCallback(
    (value: string): void => {
      const m = useTerminalMetaStore.getState().metas.get(paneId);
      const t = m?.mdTabs.find((x) => x.id === tabId);
      if (!t) return;
      const dirty = value !== (t.savedContent ?? "");
      if (t.dirty !== dirty) {
        useTerminalMetaStore.getState().setMdDirty(paneId, tabId, dirty);
      }
    },
    [paneId, tabId],
  );

  // Cmd+S を CodeMirror keymap で捕捉。default は Mod-s (Mac=Cmd / others=Ctrl)。
  const saveKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            void handleSave();
            return true;
          },
        },
      ]),
    [handleSave],
  );

  // light/dark に応じた派生色（テーマ連携の中核）
  const editorChrome = useMemo(() => {
    const isLight = isLightBackground(theme.colors.terminalBackground);
    // light テーマは pure white を避け、目に優しいオフホワイトに
    const editorBg = isLight ? "#fbfbf9" : theme.colors.terminalBackground;
    // gutter は app pane header と同色にして視覚的整合を取る
    const gutterBg = theme.colors.headerBackground;
    // inline code 背景: light は微暗いグレー、dark は微明オーバーレイ
    const codeBg = isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.07)";
    // inline code 前景: 背景輝度に応じて読みやすい色
    const codeFg = isLight ? "#a3274a" : "#e6a26a";
    // 区切り線（hr など）の色
    const ruleColor = theme.colors.border;
    return { isLight, editorBg, gutterBg, codeBg, codeFg, ruleColor };
  }, [theme.colors]);

  // テーマ連携: CodeMirror の chrome（gutter / cursor / selection / line）をアプリテーマに合わせる
  const editorTheme = useMemo(
    () =>
      EditorView.theme(
        {
          "&": {
            backgroundColor: editorChrome.editorBg,
            color: theme.colors.text,
            height: "100%",
            fontSize: `${editorSettings.fontSize}px`,
          },
          ".cm-scroller": {
            fontFamily: editorSettings.fontFamily,
            lineHeight: "1.65",
          },
          ".cm-content": {
            caretColor: theme.colors.text,
            padding: "14px 6px 32px 6px",
          },
          ".cm-gutters": {
            backgroundColor: editorChrome.gutterBg,
            color: theme.colors.textSecondary,
            border: "none",
            borderRight: `1px solid ${theme.colors.border}`,
          },
          ".cm-lineNumbers .cm-gutterElement": {
            opacity: "0.55",
            minWidth: "2.4em",
            padding: "0 8px 0 6px",
            textAlign: "right",
          },
          "&.cm-focused": {
            outline: "none",
          },
          "&.cm-focused .cm-cursor": {
            borderLeftColor: theme.colors.text,
            borderLeftWidth: "2px",
          },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
            {
              backgroundColor: `${withAlpha(theme.colors.accent, 0.28)} !important`,
            },
          ".cm-activeLine": {
            backgroundColor: withAlpha(
              theme.colors.accent,
              editorChrome.isLight ? 0.06 : 0.09,
            ),
          },
          ".cm-activeLineGutter": {
            backgroundColor: withAlpha(
              theme.colors.accent,
              editorChrome.isLight ? 0.1 : 0.16,
            ),
            color: theme.colors.text,
          },
        },
        { dark: !editorChrome.isLight },
      ),
    [
      theme.colors,
      editorChrome,
      editorSettings.fontSize,
      editorSettings.fontFamily,
    ],
  );

  // markdown 構文ハイライト（見出し / 強調 / リンク / コード / リスト等）
  const mdHighlight = useMemo(() => {
    const accent = theme.colors.accent;
    const text = theme.colors.text;
    const muted = theme.colors.textSecondary;
    return HighlightStyle.define([
      { tag: t.heading1, color: accent, fontWeight: "700" },
      { tag: t.heading2, color: accent, fontWeight: "700" },
      { tag: t.heading3, color: accent, fontWeight: "600" },
      { tag: t.heading4, color: accent, fontWeight: "600" },
      { tag: t.heading5, color: accent, fontWeight: "600" },
      { tag: t.heading6, color: accent, fontWeight: "600" },
      { tag: t.strong, fontWeight: "700", color: text },
      { tag: t.emphasis, fontStyle: "italic", color: text },
      { tag: t.strikethrough, textDecoration: "line-through", color: muted },
      { tag: t.link, color: accent, textDecoration: "underline" },
      { tag: t.url, color: accent },
      {
        tag: t.monospace,
        color: editorChrome.codeFg,
        backgroundColor: editorChrome.codeBg,
      },
      { tag: t.quote, color: muted, fontStyle: "italic" },
      // ListMark / HeaderMark / BlockquoteMark など構文記号
      { tag: t.processingInstruction, color: accent },
      // 水平線
      {
        tag: t.contentSeparator,
        color: editorChrome.ruleColor,
        fontWeight: "600",
      },
      { tag: t.meta, color: muted },
    ]);
  }, [theme.colors, editorChrome]);

  const extensions = useMemo(
    () => [
      markdown(),
      saveKeymap,
      editorTheme,
      syntaxHighlighting(mdHighlight),
      ...(editorSettings.softWrap ? [EditorView.lineWrapping] : []),
    ],
    [saveKeymap, editorTheme, mdHighlight, editorSettings.softWrap],
  );

  // ファイルパスを「ディレクトリ部分」と「ファイル名」に分けて表示する
  const { dirPart, fileName } = useMemo(() => {
    if (!filePath) return { dirPart: "", fileName: "" };
    const idx = filePath.lastIndexOf("/");
    if (idx < 0) return { dirPart: "", fileName: filePath };
    return {
      dirPart: filePath.slice(0, idx + 1),
      fileName: filePath.slice(idx + 1),
    };
  }, [filePath]);

  return (
    <div
      data-md-editor-pane={paneId}
      data-md-editor-tab={tabId}
      onMouseDownCapture={() => setActiveTerminal(paneId)}
      style={{
        height: "100%",
        width: "100%",
        backgroundColor: editorChrome.editorBg,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: themeConfig.spacing.xs,
          padding: `${themeConfig.spacing.xs} ${themeConfig.spacing.md}`,
          fontSize: 11,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          color: theme.colors.textSecondary,
          borderBottom: `1px solid ${theme.colors.border}`,
          backgroundColor: theme.colors.headerBackground,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
        title={filePath ?? ""}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "1px 6px",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: theme.colors.accent,
            border: `1px solid ${withAlpha(theme.colors.accent, 0.55)}`,
            borderRadius: 3,
            backgroundColor: withAlpha(theme.colors.accent, 0.12),
            flexShrink: 0,
          }}
        >
          MD
        </span>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            direction: "rtl",
            textAlign: "left",
          }}
        >
          <span style={{ unicodeBidi: "plaintext" }}>
            <span style={{ opacity: 0.7 }}>{dirPart}</span>
            <span style={{ color: theme.colors.text, fontWeight: 600 }}>
              {fileName}
            </span>
          </span>
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <CodeMirror
          ref={cmRef}
          value={initialValue}
          height="100%"
          theme="none"
          extensions={extensions}
          onChange={handleChange}
          onFocus={() => setActiveTerminal(paneId)}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            foldGutter: false,
            autocompletion: false,
            searchKeymap: true,
            history: true,
          }}
          style={{ height: "100%" }}
        />
      </div>
    </div>
  );
};
