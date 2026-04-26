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
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";
import {
  useTerminalMetaStore,
  useTerminalMeta,
} from "../stores/terminalMetaStore";
import { useTerminalActions } from "../stores/terminalStore";
import { showErrorToast } from "./Sidebar/ErrorToast";
import * as markdownEditorRegistry from "../services/markdownEditorRegistry";

interface MarkdownEditorProps {
  id: string;
}

// 親 (TerminalPane) は filePath 変化時に key で remount すること。
// これにより value/initialContent の同期問題を避け、CodeMirror の internal state は
// ファイル単位でフレッシュに保たれる。
export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ id }) => {
  const meta = useTerminalMeta(id);
  const filePath = meta?.mdFilePath ?? null;
  const savedContent = meta?.mdSavedContent ?? "";

  // 初期 value は mount 時に固定（後続の savedContent 変化で value を入れ替えない）
  const [initialValue] = useState(() => savedContent);

  const theme = useCurrentTheme();
  const themeConfig = useThemeConfig();
  const { setActiveTerminal } = useTerminalActions();

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
    useTerminalMetaStore.getState().markMdSaved(id, content);
    return true;
  }, [id, filePath]);

  // ペイン外部から save / focus を呼ぶための imperative API を registry に登録
  useEffect(() => {
    markdownEditorRegistry.register(id, {
      getContent: () => cmRef.current?.view?.state.doc.toString() ?? "",
      save: handleSave,
      focus: () => cmRef.current?.view?.focus(),
    });
    return () => markdownEditorRegistry.unregister(id);
  }, [id, handleSave]);

  // 入力のたびに dirty 判定を更新（mdSavedContent と一致なら dirty=false に戻す）
  const handleChange = useCallback(
    (value: string): void => {
      const meta = useTerminalMetaStore.getState().metas.get(id);
      if (!meta) return;
      const dirty = value !== (meta.mdSavedContent ?? "");
      if (meta.mdDirty !== dirty) {
        useTerminalMetaStore.getState().setMdDirty(id, dirty);
      }
    },
    [id],
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

  // テーマ連携: CodeMirror の背景・前景色をアプリテーマに合わせる
  const editorTheme = useMemo(
    () =>
      EditorView.theme(
        {
          "&": {
            backgroundColor: theme.colors.terminalBackground,
            color: theme.colors.text,
            height: "100%",
            fontSize: "13px",
          },
          ".cm-content": {
            caretColor: theme.colors.text,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          },
          ".cm-gutters": {
            backgroundColor: theme.colors.headerBackground,
            color: theme.colors.textSecondary,
            border: "none",
          },
          "&.cm-focused .cm-cursor": {
            borderLeftColor: theme.colors.text,
          },
          "&.cm-focused .cm-selectionBackground, ::selection": {
            backgroundColor: theme.colors.borderActive,
          },
          ".cm-activeLine": {
            backgroundColor: theme.colors.buttonHover,
          },
          ".cm-activeLineGutter": {
            backgroundColor: theme.colors.buttonHover,
          },
        },
        { dark: true },
      ),
    [theme.colors],
  );

  const extensions = useMemo(
    () => [markdown(), saveKeymap, editorTheme],
    [saveKeymap, editorTheme],
  );

  return (
    <div
      data-md-editor-pane={id}
      onMouseDownCapture={() => setActiveTerminal(id)}
      style={{
        height: "100%",
        width: "100%",
        backgroundColor: theme.colors.terminalBackground,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: `${themeConfig.spacing.xs} ${themeConfig.spacing.md}`,
          fontSize: 11,
          color: theme.colors.textSecondary,
          borderBottom: `1px solid ${theme.colors.border}`,
          backgroundColor: theme.colors.headerBackground,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={filePath ?? ""}
      >
        {filePath ?? ""}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <CodeMirror
          ref={cmRef}
          value={initialValue}
          height="100%"
          extensions={extensions}
          onChange={handleChange}
          onFocus={() => setActiveTerminal(id)}
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
