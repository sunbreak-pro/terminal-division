import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import "@xterm/xterm/css/xterm.css";
import {
  useActiveTerminalId,
  useTerminalActions,
} from "../stores/terminalStore";
import { useCurrentTheme, useThemeConfig } from "../stores/themeStore";
import * as terminalManager from "../services/terminalManager";
import { rafDebounceWithDelay } from "../utils/rafDebounce";
import { TerminalSubHeader } from "./TerminalSubHeader";
import {
  useTerminalMeta,
  useTerminalMetaStore,
} from "../stores/terminalMetaStore";
import { useSettingsStore, useTerminalSettings } from "../stores/settingsStore";
import {
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  clampNumber,
} from "../../shared/settings";
import { useSidebarStore } from "../stores/sidebarStore";
import { MarkdownEditor } from "./MarkdownEditor";
import { formatPaths } from "../utils/insertFiles";
import {
  useSearchOpenForPane,
  useTerminalSearchStore,
} from "../stores/terminalSearchStore";
import { TerminalSearchOverlay } from "./TerminalSearchOverlay";
import { showErrorToast } from "./Sidebar/ErrorToast";

const TD_PATH_MIME = "application/x-td-path";

interface TerminalPaneProps {
  id: string;
  paneNumber: number;
}

const TerminalPane: React.FC<TerminalPaneProps> = React.memo(
  ({ id, paneNumber }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const activeTerminalId = useActiveTerminalId();
    const { setActiveTerminal, closeTerminal } = useTerminalActions();
    const isActive = activeTerminalId === id;

    const isSearchOpen = useSearchOpenForPane(id);
    const closeSearch = useTerminalSearchStore((s) => s.close);

    const currentTheme = useCurrentTheme();
    const themeConfig = useThemeConfig();
    const theme = { colors: currentTheme.colors, ...themeConfig };
    const xtermTheme = currentTheme.xterm;

    // ターミナル設定は settings store から購読（変更で reactive に再反映）
    const terminalSettings = useTerminalSettings();
    // ペイン毎のフォントサイズ上書き（Cmd+= / Cmd+-）。null = グローバル設定に従う。
    const fontSizeOverride = useTerminalMetaStore(
      (s) => s.metas.get(id)?.fontSizeOverride ?? null,
    );
    const effectiveFontSize = clampNumber(
      fontSizeOverride ?? terminalSettings.fontSize,
      FONT_SIZE_MIN,
      FONT_SIZE_MAX,
      terminalSettings.fontSize,
    );

    // Focus terminal when it becomes active
    // ペインが非アクティブ→アクティブに切り替わった瞬間のみ最下部へスクロールする。
    // （既にアクティブな状態で useEffect が再実行されることはないので、
    //  ユーザーがスクロールして見ている途中に勝手にジャンプすることはない）
    useEffect(() => {
      if (isActive) {
        terminalManager.focus(id);
        terminalManager.scrollToBottom(id);
      }
    }, [isActive, id]);

    const handleFit = useCallback(() => {
      const result = terminalManager.fit(id);
      if (result) {
        window.api.pty.resize(id, result.cols, result.rows);
      }
    }, [id]);

    // 直前の showMd を保持して md→cli の遷移エッジだけを検出する。
    const prevShowMdRef = useRef<boolean>(false);

    // useLayoutEffect: DOM 反映後・paint 前に同期実行されるため、
    // attach → fit → pty.create の順序を setTimeout(0) なしで保証できる。
    // StrictMode の二重マウントでも同期 fit が冪等なため安全。
    useLayoutEffect(() => {
      if (!containerRef.current) return;

      // 1. Get or create terminal instance (callbacks are registered ONCE during creation)
      const instance = terminalManager.getOrCreate(
        id,
        {
          theme: xtermTheme,
          fontFamily: terminalSettings.fontFamily,
          fontSize: effectiveFontSize,
          lineHeight: terminalSettings.lineHeight,
          cursorBlink: terminalSettings.cursorBlink,
          cursorStyle: terminalSettings.cursorStyle,
          allowTransparency: true,
          allowProposedApi: true,
          scrollback: terminalSettings.scrollback,
          wordSeparator: terminalSettings.wordSeparator,
        },
        {
          onData: (data) => {
            window.api.pty.write(id, data);
          },
          onExit: (exitCode: number) => {
            // 設定が有効でかつ異常終了のときだけ macOS 通知を出す
            const general = useSettingsStore.getState().settings.general;
            if (
              general.ptyExitNotification &&
              exitCode !== 0 &&
              typeof Notification !== "undefined" &&
              Notification.permission === "granted"
            ) {
              try {
                const meta = useTerminalMetaStore.getState().metas.get(id);
                const titleSrc =
                  meta?.customTitle ||
                  meta?.processName ||
                  meta?.shellName ||
                  "ターミナル";
                new Notification(`${titleSrc} が異常終了`, {
                  body: `exit code: ${exitCode}${meta?.cwd ? `\n${meta.cwd}` : ""}`,
                  silent: false,
                });
              } catch {
                // 通知失敗は致命的ではないので握りつぶす
              }
            }
            closeTerminal(id);
          },
          onFocus: () => {
            setActiveTerminal(id);
            useSidebarStore.getState().setLastInteractedArea("terminal");
          },
        },
      );

      // 2. Attach to DOM container
      terminalManager.attachToContainer(id, containerRef.current);

      // 3. Set up PTY (only if not already created)
      if (!instance.ptyCreated) {
        // Mark as created IMMEDIATELY to prevent duplicate registration on StrictMode remount
        instance.ptyCreated = true;

        // attach 直後の同期 fit でターミナルサイズを確定し、その値で pty.create を発火
        instance.fitAddon.fit();
        const { cols, rows } = instance.terminal;

        // CWD優先順位: メタストア（分割時設定） > windowInitialCwd（Dockメニュー） > undefined
        const initialCwd =
          useTerminalMetaStore.getState().metas.get(id)?.cwd ??
          window.api.window.getInitialCwd() ??
          undefined;

        // 設定で指定されたカスタムシェル / デフォルト CWD を Main 側へ渡す。
        // 空文字列は「未設定（$SHELL / $HOME に従う）」を意味する。
        const ptyOptions = {
          shell: terminalSettings.defaultShell || undefined,
          defaultCwd: terminalSettings.defaultCwd || undefined,
        };

        window.api.pty
          .create(id, initialCwd, ptyOptions)
          .then((ok) => {
            if (!ok) {
              // Main 側で spawn 失敗（shell ENOENT、permission denied 等）。
              // 黒いままのターミナルを残さないよう、xterm に明示メッセージ + toast 通知する。
              console.error(`PTY spawn failed for terminal ${id}`);
              instance.terminal.write(
                "\r\n\x1b[31mError: ターミナルプロセスの起動に失敗しました\x1b[0m\r\n",
              );
              showErrorToast(
                "ターミナルプロセスの起動に失敗しました（シェルが見つからないか権限不足の可能性）",
              );
              return;
            }
            window.api.pty.resize(id, cols, rows);
            // Main 側で spawn 直後に溜めた初期出力（zsh 起動メッセージなど）を flush する。
            // pty:data リスナーは getOrCreate 内で同期登録済みなので確実に受け取れる。
            window.api.pty.flushInitialBuffer(id);
          })
          .catch((error) => {
            console.error(`Failed to create PTY for terminal ${id}:`, error);
            instance.terminal.write(
              "\r\n\x1b[31mError: Failed to create terminal process\x1b[0m\r\n",
            );
            showErrorToast("ターミナルプロセスの起動に失敗しました");
          });
      } else {
        // Terminal already exists, just fit it (同期で fit、ResizeObserver の通知に頼らない)
        handleFit();
      }

      // 4. Set up ResizeObserver with rAF-based debounce
      // delay=0 + requestAnimationFrame: 同フレーム内の連続通知を 1 回にまとめる
      // だけにする。Panel.onResize と viewMode 同期 fit が主経路で、observer は
      // フォールバック（サイドバー開閉や OS のリサイズ等）。遅延を縮めることで
      // scrollback が古い cols のまま残る時間を最小化。
      const { handler: debouncedFit, cancel: cancelFit } = rafDebounceWithDelay(
        handleFit,
        0,
      );
      const resizeObserver = new ResizeObserver(() => {
        debouncedFit();
      });
      resizeObserver.observe(containerRef.current);

      // Cleanup: only disconnect observer, do NOT dispose terminal or kill PTY
      return () => {
        cancelFit();
        resizeObserver.disconnect();
      };
    }, [id, closeTerminal]);

    // ベル動作: visual = ペインを 1 フレーム反転、sound = WebAudio で短い beep。
    // none は購読しない（ループ防止のため設定変化の度に re-subscribe）。
    useEffect(() => {
      if (terminalSettings.bellStyle === "none") return;
      const unsub = terminalManager.subscribeBell(id, () => {
        if (terminalSettings.bellStyle === "visual") {
          const el = containerRef.current;
          if (!el) return;
          el.style.transition = "background-color 80ms ease";
          const orig = el.style.backgroundColor;
          el.style.backgroundColor = "rgba(255,255,255,0.18)";
          window.setTimeout(() => {
            el.style.backgroundColor = orig;
          }, 120);
        } else if (terminalSettings.bellStyle === "sound") {
          // 軽量な WebAudio beep。ライブラリ依存なし。
          try {
            const Ctx =
              window.AudioContext ||
              (
                window as unknown as {
                  webkitAudioContext?: typeof AudioContext;
                }
              ).webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = 880;
            gain.gain.value = 0.05;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.08);
            osc.onended = () => ctx.close();
          } catch {
            // 音声出力失敗時は無視
          }
        }
      });
      return unsub;
    }, [id, terminalSettings.bellStyle]);

    // 設定変更（フォント / カーソル / scrollback 等）に反応して xterm へ再適用する。
    // フォントサイズ系（セルサイズ変動）は applyOptions が fit して pty.resize を発火する。
    useEffect(() => {
      const result = terminalManager.applyOptions(id, {
        fontFamily: terminalSettings.fontFamily,
        fontSize: effectiveFontSize,
        lineHeight: terminalSettings.lineHeight,
        cursorBlink: terminalSettings.cursorBlink,
        cursorStyle: terminalSettings.cursorStyle,
        scrollback: terminalSettings.scrollback,
        wordSeparator: terminalSettings.wordSeparator,
      });
      if (result) {
        window.api.pty.resize(id, result.cols, result.rows);
      }
    }, [
      id,
      terminalSettings.fontFamily,
      terminalSettings.lineHeight,
      terminalSettings.cursorBlink,
      terminalSettings.cursorStyle,
      terminalSettings.scrollback,
      terminalSettings.wordSeparator,
      effectiveFontSize,
    ]);

    const handleMouseDown = useCallback((): void => {
      setActiveTerminal(id);
      useSidebarStore.getState().setLastInteractedArea("terminal");
    }, [id, setActiveTerminal]);

    // ===== D&D: ツリーや外部からファイルをドロップしてパスを挿入 =====
    const handleDragOver = useCallback((e: React.DragEvent): void => {
      // パス含む drag のみ受け入れる
      const types = e.dataTransfer.types;
      if (
        types.includes(TD_PATH_MIME) ||
        types.includes("Files") ||
        types.includes("text/plain")
      ) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    }, []);

    const handleDrop = useCallback(
      (e: React.DragEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        setActiveTerminal(id);

        // 1) ツリー内 D&D: 独自 MIME から path を取得
        const internal = e.dataTransfer.getData(TD_PATH_MIME);
        if (internal) {
          window.api.pty.write(id, formatPaths([internal]));
          return;
        }
        // 2) 外部 (Finder 等) からのファイル: webUtils 経由でパスを取得
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
          const paths = files
            .map((f) => window.api.fs.getPathForFile(f))
            .filter((p) => p && p.length > 0);
          if (paths.length > 0) {
            window.api.pty.write(id, formatPaths(paths));
            return;
          }
        }
        // 3) 最終手段: text/plain から取得
        const text = e.dataTransfer.getData("text/plain");
        if (text) {
          window.api.pty.write(id, formatPaths([text]));
        }
      },
      [id, setActiveTerminal],
    );

    // Memoize container style
    const containerStyle = useMemo(
      () => ({
        height: "100%",
        width: "100%",
        padding: "3px",
        borderColor: theme.colors.border,
        borderRadius: theme.borderRadius,
        position: "relative" as const,
        boxSizing: "border-box" as const,
        border: isActive
          ? `3px solid ${theme.colors.activeTerminal}`
          : `2px solid ${theme.colors.border}`,
      }),
      [
        isActive,
        theme.colors.border,
        theme.colors.activeTerminal,
        theme.borderRadius,
      ],
    );

    // viewMode === "md" のとき MarkdownEditor を前面に表示し、
    // xterm のコンテナは display:none で残す。これにより PTY と xterm.js の
    // バッファ・カーソル位置が完全に保たれ、CLI に戻るとそのまま再開できる。
    const meta = useTerminalMeta(id);
    const showMd = meta?.viewMode === "md" && !!meta.mdFilePath;

    // md → cli への復帰時に同期 fit + pty.resize を実行する。
    // display:none 中は fit() の lastSizes キャッシュが古いまま PTY 側に残るので、
    // 復帰直前に invalidate して必ず最新サイズで pty.resize を発火させる。
    // useLayoutEffect で paint 前に実行することで、復帰直後にユーザーが入力したり
    // Claude Code が描画する文字が古い cols で wrap されるのを防ぐ。
    useLayoutEffect(() => {
      const prev = prevShowMdRef.current;
      prevShowMdRef.current = showMd;
      if (!showMd && prev) {
        terminalManager.invalidateLastSize(id);
        handleFit();
      }
    }, [showMd, id, handleFit]);
    // 同一ファイルを再オープンした場合でも MarkdownEditor を remount するため、
    // mdLoadedAt を key に含める。filePath だけだと、再ロード時にエディタが
    // 古い doc を表示し続けてしまう。
    const mdEditorKey = `${meta?.mdFilePath ?? ""}#${meta?.mdLoadedAt ?? 0}`;

    return (
      <div
        className="terminal-container"
        onMouseDown={handleMouseDown}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={containerStyle}
      >
        <TerminalSubHeader id={id} paneNumber={paneNumber} />
        <div
          style={{
            height: "calc(100% - 28px)",
            width: "100%",
            position: "relative",
          }}
        >
          <div
            ref={containerRef}
            style={{
              height: "100%",
              width: "100%",
              display: showMd ? "none" : "block",
            }}
          />
          {showMd && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                height: "100%",
                width: "100%",
              }}
            >
              <MarkdownEditor key={mdEditorKey} id={id} />
            </div>
          )}
          {isSearchOpen && !showMd && (
            <TerminalSearchOverlay paneId={id} onClose={closeSearch} />
          )}
        </div>
      </div>
    );
  },
);

TerminalPane.displayName = "TerminalPane";

export default TerminalPane;
