import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";
import * as terminalManager from "../services/terminalManager";
import {
  usePathHistory,
  usePathHistoryStore,
} from "../stores/pathHistoryStore";
import { useTerminalMetaStore } from "../stores/terminalMetaStore";
import { formatPaths } from "../utils/insertFiles";

interface TerminalSearchOverlayProps {
  paneId: string;
  onClose: () => void;
}

type Mode = "text" | "path";

/**
 * Cmd+F で開くアクティブペイン専用の検索オーバーレイ。
 * - text モード: SearchAddon で xterm バッファを順送り検索（Enter / Shift+Enter）
 * - path モード: PTY 出力から抽出した絶対 / 相対パス履歴を絞り込み、Enter で挿入
 *
 * Esc でクローズ。アクティブペインが変わると親側で再マウントされ自然に閉じる。
 */
export const TerminalSearchOverlay: React.FC<TerminalSearchOverlayProps> = ({
  paneId,
  onClose,
}) => {
  const theme = useCurrentTheme();
  const config = useThemeConfig();

  const [mode, setMode] = useState<Mode>("text");
  const [query, setQuery] = useState("");
  const [pathFilter, setPathFilter] = useState("");
  const [pathSelectedIdx, setPathSelectedIdx] = useState(0);
  const [searchMissing, setSearchMissing] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [regexInvalid, setRegexInvalid] = useState(false);
  // -1 / 0 はマッチなし、>=1 で実マッチ件数
  const [resultCount, setResultCount] = useState(0);
  const [resultIndex, setResultIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // 入力フォーカス
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [mode]);

  // オープン時とクローズ時に検索装飾をクリア
  useEffect(() => {
    return () => {
      terminalManager.clearSearchDecorations(paneId);
    };
  }, [paneId]);

  // SearchAddon のヒット件数イベントを購読
  useEffect(() => {
    if (mode !== "text") return;
    const unsubscribe = terminalManager.subscribeSearchResults(
      paneId,
      ({ resultIndex: idx, resultCount: count }) => {
        setResultIndex(idx);
        setResultCount(count);
      },
    );
    return unsubscribe;
  }, [paneId, mode]);

  // 正規表現バリデーション（regex モード時のみ）
  useEffect(() => {
    if (!useRegex || query.length === 0) {
      setRegexInvalid(false);
      return;
    }
    try {
      new RegExp(query);
      setRegexInvalid(false);
    } catch {
      setRegexInvalid(true);
    }
  }, [useRegex, query]);

  const searchOptions = useMemo(
    () => ({ caseSensitive, wholeWord, regex: useRegex }),
    [caseSensitive, wholeWord, useRegex],
  );

  // === Text モード: 検索ナビゲーション ===
  const runFind = useCallback(
    (direction: "next" | "prev") => {
      if (query.length === 0 || regexInvalid) {
        setSearchMissing(false);
        return;
      }
      const found =
        direction === "next"
          ? terminalManager.findNext(paneId, query, searchOptions)
          : terminalManager.findPrevious(paneId, query, searchOptions);
      setSearchMissing(!found);
    },
    [paneId, query, searchOptions, regexInvalid],
  );

  // クエリ・オプション変更時に装飾とヒット件数をリフレッシュ。
  // incremental: true により、現在のマッチが新しい query にも引き続き
  // マッチしている間はカーソルを動かさない（VSCode 風のインクリメンタル検索）。
  useEffect(() => {
    if (mode !== "text") return;
    if (query.length === 0 || regexInvalid) {
      terminalManager.clearSearchDecorations(paneId);
      setSearchMissing(false);
      setResultCount(0);
      setResultIndex(-1);
      return;
    }
    const found = terminalManager.findNext(paneId, query, {
      ...searchOptions,
      incremental: true,
    });
    setSearchMissing(!found);
  }, [paneId, query, searchOptions, regexInvalid, mode]);

  // === Path モード: 履歴抽出 + フィルタ ===
  const rawHistory = usePathHistory(paneId);
  const filteredPaths = useMemo(() => {
    const sorted = rawHistory
      .slice()
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    if (pathFilter.length === 0) return sorted;
    const lower = pathFilter.toLowerCase();
    return sorted.filter((e) => e.raw.toLowerCase().includes(lower));
  }, [rawHistory, pathFilter]);

  // フィルタ変更で選択行を先頭に戻す
  useEffect(() => {
    setPathSelectedIdx(0);
  }, [pathFilter, mode]);

  const insertPath = useCallback(
    (raw: string) => {
      window.api.pty.write(paneId, formatPaths([raw]));
      onClose();
    },
    [paneId, onClose],
  );

  const copyPath = useCallback(async (raw: string) => {
    try {
      await navigator.clipboard.writeText(raw);
    } catch {
      /* noop: テーマトーストは既存の ErrorToast 経路と分離しておく */
    }
  }, []);

  // 共通キーハンドラ
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // タブ切替
      if (e.key === "Tab") {
        e.preventDefault();
        setMode((m) => (m === "text" ? "path" : "text"));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      // テキスト編集系のショートカット（macOS 標準。Electron の <input> では
      // Cmd+ArrowLeft/Right が効かない・Cmd+Backspace が行頭削除にならないことが
      // あるため明示的にハンドリングする）
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod) {
        const target = e.currentTarget;
        if (e.key === "Backspace") {
          // Cmd+Backspace: 入力欄を全クリア
          e.preventDefault();
          if (mode === "text") {
            setQuery("");
          } else {
            setPathFilter("");
          }
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          target.setSelectionRange(0, 0);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          const end = target.value.length;
          target.setSelectionRange(end, end);
          return;
        }
      }

      if (mode === "text") {
        if (e.key === "Enter") {
          e.preventDefault();
          runFind(e.shiftKey ? "prev" : "next");
        }
        return;
      }

      // path モード
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPathSelectedIdx((i) =>
          Math.min(i + 1, Math.max(0, filteredPaths.length - 1)),
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPathSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const target = filteredPaths[pathSelectedIdx];
        if (target) insertPath(target.raw);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        const target = filteredPaths[pathSelectedIdx];
        if (target) {
          e.preventDefault();
          void copyPath(target.raw);
        }
        return;
      }
    },
    [
      mode,
      runFind,
      onClose,
      filteredPaths,
      pathSelectedIdx,
      insertPath,
      copyPath,
    ],
  );

  // CWD 表示（相対パスを絶対化したヒントとして補助表示）
  const cwd = useTerminalMetaStore((s) => s.metas.get(paneId)?.cwd ?? null);

  const tabButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: "2px 8px",
    fontSize: 11,
    cursor: "pointer",
    border: `1px solid ${active ? theme.colors.borderActive : theme.colors.border}`,
    borderRadius: config.borderRadius,
    backgroundColor: active
      ? theme.colors.buttonHover
      : theme.colors.headerBackground,
    color: active ? theme.colors.text : theme.colors.textSecondary,
    userSelect: "none",
  });

  // 検索オプショントグル（Aa / Ab / .*）。アクティブ時は強調色で塗る。
  const optionButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: "0 6px",
    minWidth: 26,
    fontSize: 11,
    fontFamily: "Menlo, Monaco, monospace",
    cursor: "pointer",
    border: `1px solid ${active ? theme.colors.accent : theme.colors.border}`,
    borderRadius: config.borderRadius,
    backgroundColor: active
      ? theme.colors.accent
      : theme.colors.headerBackground,
    color: active ? "#ffffff" : theme.colors.textSecondary,
    userSelect: "none",
  });

  return (
    <div
      role="dialog"
      aria-label="ターミナル検索"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: 26,
        right: 8,
        width: 360,
        zIndex: 50,
        backgroundColor: theme.colors.headerBackground,
        border: `1px solid ${theme.colors.borderActive}`,
        borderRadius: config.borderRadius,
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        padding: 6,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => setMode("text")}
          style={tabButtonStyle(mode === "text")}
        >
          Text
        </button>
        <button
          type="button"
          onClick={() => setMode("path")}
          style={tabButtonStyle(mode === "path")}
        >
          Path 履歴 ({rawHistory.length})
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          title="閉じる (Esc)"
          style={{
            background: "transparent",
            border: "none",
            color: theme.colors.textSecondary,
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: "0 4px",
          }}
        >
          ×
        </button>
      </div>

      {mode === "text" ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              gap: 4,
            }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchMissing(false);
              }}
              onKeyDown={handleKeyDown}
              placeholder="検索ワード… Enter で次へ / Shift+Enter で前へ"
              spellCheck={false}
              style={{
                flex: 1,
                backgroundColor: theme.colors.background,
                color: theme.colors.text,
                border: `1px solid ${
                  regexInvalid || searchMissing
                    ? theme.colors.danger
                    : theme.colors.border
                }`,
                borderRadius: config.borderRadius,
                padding: "4px 6px",
                fontSize: 12,
                fontFamily: "inherit",
                boxSizing: "border-box",
                minWidth: 0,
              }}
            />
            <button
              type="button"
              onClick={() => setCaseSensitive((v) => !v)}
              title="大文字と小文字を区別 (Aa)"
              aria-pressed={caseSensitive}
              style={optionButtonStyle(caseSensitive)}
            >
              Aa
            </button>
            <button
              type="button"
              onClick={() => setWholeWord((v) => !v)}
              title="単語単位で一致 (Ab)"
              aria-pressed={wholeWord}
              style={optionButtonStyle(wholeWord)}
            >
              Ab
            </button>
            <button
              type="button"
              onClick={() => setUseRegex((v) => !v)}
              title="正規表現 (.*)"
              aria-pressed={useRegex}
              style={optionButtonStyle(useRegex)}
            >
              .*
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, fontSize: 11 }}>
            <button
              type="button"
              onClick={() => runFind("prev")}
              style={tabButtonStyle(false)}
            >
              ↑ 前へ
            </button>
            <button
              type="button"
              onClick={() => runFind("next")}
              style={tabButtonStyle(false)}
            >
              ↓ 次へ
            </button>
            <div style={{ flex: 1 }} />
            <span
              style={{
                color:
                  regexInvalid || (searchMissing && query.length > 0)
                    ? theme.colors.danger
                    : theme.colors.textSecondary,
                alignSelf: "center",
              }}
            >
              {regexInvalid
                ? "正規表現が不正です"
                : query.length === 0
                  ? "Tab: Path"
                  : resultCount === 0
                    ? "見つかりません"
                    : resultIndex < 0
                      ? `${resultCount} 件超`
                      : `${resultIndex + 1} / ${resultCount}`}
            </span>
          </div>
        </>
      ) : (
        <>
          <input
            ref={inputRef}
            value={pathFilter}
            onChange={(e) => setPathFilter(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="パスを絞り込み… Enter で挿入 / ⌘C でコピー"
            spellCheck={false}
            style={{
              width: "100%",
              backgroundColor: theme.colors.background,
              color: theme.colors.text,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: config.borderRadius,
              padding: "4px 6px",
              fontSize: 12,
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              maxHeight: 220,
              overflowY: "auto",
              border: `1px solid ${theme.colors.border}`,
              borderRadius: config.borderRadius,
              backgroundColor: theme.colors.background,
            }}
          >
            {filteredPaths.length === 0 ? (
              <div
                style={{
                  padding: 8,
                  fontSize: 11,
                  color: theme.colors.textSecondary,
                }}
              >
                {rawHistory.length === 0
                  ? "まだパスが検出されていません"
                  : "一致するパスがありません"}
              </div>
            ) : (
              filteredPaths.map((entry, idx) => {
                const selected = idx === pathSelectedIdx;
                return (
                  <div
                    key={`${entry.raw}-${idx}`}
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setPathSelectedIdx(idx);
                    }}
                    onDoubleClick={() => insertPath(entry.raw)}
                    style={{
                      padding: "3px 6px",
                      fontSize: 11,
                      fontFamily: "Menlo, Monaco, monospace",
                      color: theme.colors.text,
                      backgroundColor: selected
                        ? theme.colors.buttonHover
                        : "transparent",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      borderLeft: `2px solid ${
                        entry.kind === "absolute"
                          ? theme.colors.accent
                          : theme.colors.borderActive
                      }`,
                    }}
                    title={entry.raw}
                  >
                    <span
                      style={{
                        color:
                          entry.kind === "absolute"
                            ? theme.colors.accent
                            : theme.colors.textSecondary,
                        marginRight: 6,
                        fontSize: 10,
                      }}
                    >
                      {entry.kind === "absolute" ? "ABS" : "REL"}
                    </span>
                    {entry.raw}
                    {entry.count > 1 && (
                      <span
                        style={{
                          color: theme.colors.textSecondary,
                          marginLeft: 6,
                          fontSize: 10,
                        }}
                      >
                        ×{entry.count}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 10,
              color: theme.colors.textSecondary,
              gap: 8,
            }}
          >
            <span>↑↓ 選択 / Enter 挿入 / ⌘C コピー / Tab: Text</span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => usePathHistoryStore.getState().clearPane(paneId)}
              style={{
                background: "transparent",
                border: "none",
                color: theme.colors.textSecondary,
                cursor: "pointer",
                fontSize: 10,
                padding: 0,
                textDecoration: "underline",
              }}
            >
              履歴クリア
            </button>
          </div>
          {cwd && (
            <div
              style={{
                fontSize: 10,
                color: theme.colors.textSecondary,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={cwd}
            >
              CWD: {cwd}
            </div>
          )}
        </>
      )}
    </div>
  );
};
