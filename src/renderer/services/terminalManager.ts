import {
  Terminal,
  ITerminalOptions,
  IMarker,
  IDecoration,
  ILink,
} from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon, ISearchOptions } from "@xterm/addon-search";
import { useTerminalMetaStore } from "../stores/terminalMetaStore";
import { usePathHistoryStore } from "../stores/pathHistoryStore";
import { findPaths } from "../utils/markdownPath";
import { buildOffsetToColumnMap } from "../utils/xtermLine";
import type { XtermTheme } from "../../shared/theme-types";

// 行単位 Undo/Redo 履歴の最大保持数
const MAX_UNDO_STACK_SIZE = 100;

export interface InputHistoryState {
  undoStack: string[];
  redoStack: string[];
  currentLine: string;
}

// プロンプトドットの状態管理（ターミナルID毎）
// シェルからOSC 7770シーケンスを受信し、マーカー+デコレーションでドット色を制御
interface PromptDotState {
  marker: IMarker | null; // 現在のプロンプト行マーカー
  decoration: IDecoration | null; // 色変更用デコレーション
}

export interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  ptyCreated: boolean;
  compositionRegistered: boolean;
  // PTY 起動直後はシェルがまだ canonical mode で readline (zle) が起動していないため、
  // \x01 / \x05 等の制御コードを送ると ^A / ^E と echo されてしまう。
  // OSC 7770;A（プロンプト直前）受信で true にし、それまでショートカット由来の
  // PTY 書き込みは silent suppress する。シェル統合 OSC が来ない構成
  // （fish 等）では永久に suppress されるが、誤った ^A/^E 表示よりは安全。
  shellReady: boolean;
  dataListenerRemover: (() => void) | null;
  exitListenerRemover: (() => void) | null;
  inputHistory: InputHistoryState;
  promptDot: PromptDotState;
}

// xterm.js の ALT screen（vim / less / fzf 等の TUI）中は履歴を変えない
function isAltScreen(terminal: Terminal): boolean {
  return terminal.buffer.active.type === "alternate";
}

// Cmd+Z / Cmd+Shift+Z の Undo/Redo は Ctrl+E + Ctrl+U + 再入力 の readline (zle/bash)
// 前提のパッチで実現している。Claude Code (Ink TUI) のように readline を使わない
// 子プロセスが前面にいるときに発火させると、`\x05` `\x15` がそのまま入力欄に
// 流し込まれて壊れる。前面プロセス名がシェル名と一致しているときのみ有効化する。
// processName ポーリングは 1 秒間隔のため、子プロセス起動直後の数百 ms は
// 旧値を見る可能性があるが、誤って暴発するよりは安全。
function isReadlineActive(id: string): boolean {
  const meta = useTerminalMetaStore.getState().metas.get(id);
  if (!meta) return false;
  // 起動直後はまだ processName がポーリングされていない。shellName が確定していれば
  // それを readline と見なす（実用上、起動直後はプロンプト待ちのため安全）。
  if (meta.processName === null) return meta.shellName !== null;
  if (meta.shellName === null) return false;
  return meta.processName === meta.shellName;
}

function pushHistoryState(history: InputHistoryState, newLine: string): void {
  if (history.currentLine === newLine) return;
  history.redoStack = [];
  history.undoStack.push(history.currentLine);
  if (history.undoStack.length > MAX_UNDO_STACK_SIZE) {
    history.undoStack.shift();
  }
  history.currentLine = newLine;
}

// キー入力 / ショートカット送信を履歴に反映する
// 正確なカーソル位置を追跡していないため、Ctrl+K / Option+D 等の
// カーソル依存操作は履歴変更を行わない（fail-soft）
function applyHistoryDelta(history: InputHistoryState, data: string): void {
  if (data === "\r" || data === "\n") {
    history.undoStack = [];
    history.redoStack = [];
    history.currentLine = "";
    return;
  }
  if (data === "\x7f" || data === "\b") {
    pushHistoryState(history, history.currentLine.slice(0, -1));
    return;
  }
  if (data === "\x15") {
    pushHistoryState(history, "");
    return;
  }
  if (data === "\x17") {
    pushHistoryState(history, history.currentLine.replace(/\s*\S+\s*$/, ""));
    return;
  }
  if (data === "\x0b" || data === "\x1bd") {
    return;
  }
  if (data.length === 1 && data.charCodeAt(0) < 32) {
    return;
  }
  if (data.length > 1 && data.charCodeAt(0) === 0x1b) {
    return;
  }
  pushHistoryState(history, history.currentLine + data);
}

// Module-scope registry (independent of React lifecycle)
const registry = new Map<string, TerminalInstance>();

export interface TerminalCallbacks {
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
  onFocus: () => void;
  // Cmd/Ctrl + クリックで .md / .markdown パスがアクティブ化された時に発火する。
  // raw は xterm 行から検出した文字列そのまま（チルダ・相対表記を保持）。
  // 解決は呼び出し側（TerminalPane）で行う。未指定時は何もしない。
  onMarkdownLinkClick?: (raw: string) => void;
  // Cmd/Ctrl + クリックで .md 以外のパス (ファイル / ディレクトリ) が開かれる時。
  // shell.openPath で OS のデフォルトハンドラに渡す想定。
  onPathOpen?: (raw: string) => void;
  // パス文字列の上にマウスが入った時。tooltip 表示用に MouseEvent と raw を渡す。
  onPathHover?: (raw: string, event: MouseEvent) => void;
  // パス文字列から離れた時。tooltip を消す。
  onPathLeave?: () => void;
}

/**
 * Get an existing terminal instance or create a new one
 * Callbacks are only registered once when the instance is first created
 */
export function getOrCreate(
  id: string,
  options: ITerminalOptions,
  callbacks: TerminalCallbacks,
): TerminalInstance {
  const existing = registry.get(id);
  if (existing) {
    return existing;
  }

  const terminal = new Terminal(options);
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  // SearchAddon: Cmd+F のオーバーレイから利用
  const searchAddon = new SearchAddon();
  terminal.loadAddon(searchAddon);

  // WebLinksAddon: Cmd+クリック（Mac）/ Ctrl+クリック（Win/Linux）で外部ブラウザを開く
  const webLinksAddon = new WebLinksAddon((event, url) => {
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    const modifierPressed = isMac ? event.metaKey : event.ctrlKey;

    if (modifierPressed) {
      event.preventDefault();
      window.api.shell.openExternal(url);
    }
  });
  terminal.loadAddon(webLinksAddon);

  // パス全般の link provider。
  // - `.md` / `.markdown`: Cmd/Ctrl + クリックで onMarkdownLinkClick (右サイドバー)
  // - その他のパス: Cmd/Ctrl + クリックで onPathOpen (shell.openPath)
  // - 共通: hover で onPathHover、離脱で onPathLeave (tooltip 制御)
  // WebLinksAddon の URL とは検出範囲を分けるため、findPaths 内で http(s) 範囲を除外。
  terminal.registerLinkProvider({
    provideLinks(bufferLineNumber, callback): void {
      const buffer = terminal.buffer.active;
      const line = buffer.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      const matches = findPaths(text);
      if (matches.length === 0) {
        callback(undefined);
        return;
      }
      // 全角文字 (CJK / 絵文字) を含む行で、文字列 offset をそのまま column として
      // 渡すと link decoration が左にずれる。セル列ベースのマップを 1 度作って
      // 各 match 範囲を変換する。
      const offsetToCol = buildOffsetToColumnMap(line);
      const links: ILink[] = matches.map((m) => {
        const startCol = offsetToCol[m.start] ?? m.start + 1;
        const endCol = offsetToCol[m.end - 1] ?? m.end;
        return {
          range: {
            start: { x: startCol, y: bufferLineNumber },
            end: { x: endCol, y: bufferLineNumber },
          },
          text: m.raw,
          activate: (event: MouseEvent, raw: string): void => {
            const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
            const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
            if (!modifierPressed) return;
            event.preventDefault();
            if (m.kind === "md") {
              callbacks.onMarkdownLinkClick?.(raw);
            } else {
              callbacks.onPathOpen?.(raw);
            }
          },
          hover: (event: MouseEvent, raw: string): void => {
            callbacks.onPathHover?.(raw, event);
          },
          leave: (): void => {
            callbacks.onPathLeave?.();
          },
        };
      });
      callback(links);
    },
  });

  // IME composition state tracking
  // When composing (e.g., typing Japanese), macOS IME may split long compositions
  // and xterm.js may fire onData with partial text. We skip those to prevent corruption.
  let isComposing = false;
  // Track data sent via compositionend to prevent double-sending
  // (xterm.js sends the same data via setTimeout(0) after compositionend)
  let lastCompositionData: string | null = null;

  const inputHistory: InputHistoryState = {
    undoStack: [],
    redoStack: [],
    currentLine: "",
  };

  // Register terminal.onData listener ONCE during instance creation
  const terminalDataDisposable = terminal.onData((data) => {
    // Non-ASCII characters during IME composition are handled by compositionend only.
    // Skip them here to prevent double-send or corruption during long IME compositions.
    // But allow non-ASCII when NOT composing (e.g., paste operations).
    if (isComposing && /[^\x00-\x7F]/.test(data)) {
      return;
    }

    // Skip if this data was already sent via compositionend (prevent double-send)
    if (lastCompositionData !== null && data === lastCompositionData) {
      lastCompositionData = null;
      return;
    }
    lastCompositionData = null;

    if (!isAltScreen(terminal)) {
      applyHistoryDelta(inputHistory, data);
    }
    callbacks.onData(data);
  });

  // Register IPC listeners ONCE during instance creation
  const dataListenerRemover = window.api.pty.onData((event) => {
    if (event.id === id) {
      terminal.write(event.data);
      // パス履歴抽出は ALT screen 中はスキップ（vim/less の表示文字列を拾わない）
      if (!isAltScreen(terminal)) {
        feedPathHistory(id, event.data);
      }
    }
  });

  const exitListenerRemover = window.api.pty.onExit((event) => {
    if (event.id === id) {
      callbacks.onExit(event.exitCode);
    }
  });

  // OSC 7770: プロンプトドットカラー制御
  // A = プロンプト開始（カーソル位置にマーカーを保存）
  // D;N = コマンド完了（N=exit code、前のプロンプトのドットを緑/赤に更新）
  const oscDisposable = terminal.parser.registerOscHandler(
    7770,
    (data: string) => {
      try {
        const parts = data.split(";");
        const command = parts[0];

        if (command === "D") {
          // コマンド完了 → 前のプロンプトのドットを緑/赤に更新
          // onRenderでDOMオーバーレイに直接スタイル適用（canvas再描画に依存しない）
          const exitCode = parseInt(parts[1] || "0", 10);
          const inst = registry.get(id);
          const state = inst?.promptDot;
          if (state?.marker && !state.marker.isDisposed) {
            // 古いデコレーションを破棄
            if (state.decoration) state.decoration.dispose();
            // テーマから緑/赤・背景色を取得（フォールバック付き）
            const theme = (terminal.options.theme || {}) as Record<
              string,
              string
            >;
            const color =
              exitCode === 0
                ? theme.green || "#4EC94E"
                : theme.red || "#E55561";
            const bg = theme.background || "#0d0d0d";

            const decoration = terminal.registerDecoration({
              marker: state.marker,
              x: 0,
              width: 1,
              height: 1,
              layer: "top",
            });

            if (decoration) {
              decoration.onRender((element) => {
                // xtermはマーカーがビューポート外のとき display:"none" を設定して onRender を発火する。
                // ここで無条件に display を上書きすると、スクロールアウトした過去プロンプトのドットが
                // 左端(x=0, top=0付近)に貼り付いたまま残る。display:"none" は必ず尊重する。
                if (element.style.display === "none") return;
                element.style.backgroundColor = bg;
                element.style.color = color;
                element.textContent = "●";
                element.style.fontFamily =
                  terminal.options.fontFamily ||
                  'Menlo, Monaco, "Courier New", monospace';
                element.style.fontSize = `${terminal.options.fontSize || 13}px`;
                element.style.display = "flex";
                element.style.alignItems = "center";
                element.style.justifyContent = "center";
                element.style.overflow = "hidden";
              });
              state.decoration = decoration;
            }
          }
        } else if (command === "A") {
          // プロンプト開始 → 新しいマーカーを保存（デコレーションなし = シェルのグレー●がそのまま見える）
          // 重要: 直前の marker / decoration は明示的に dispose しない。
          //   precmd → D;N で打った色付き● の直後に zle-line-init → A が走るため、
          //   ここで dispose すると「成功/失敗色が一瞬すらユーザに見えずグレーに戻る」
          //   ように見えてしまう（実際にはコマンド完了瞬間に色が付き、新プロンプト
          //   到達と同時に消える）。OSC 7770 の意図 (iTerm2/VSCode の semantic prompt
          //   と同じく、過去プロンプトに成功/失敗を視覚的に残す) に沿うため、
          //   過去 decoration はそのまま残し、参照だけ捨てる。
          //   xterm.js は scrollback 上限到達で marker を自動 dispose し、
          //   それに連動して decoration も破棄されるためメモリリークしない。
          const marker = terminal.registerMarker(0);
          const inst = registry.get(id);
          if (marker && inst) {
            inst.promptDot = { marker, decoration: null };
          }
          // 初回プロンプト到達 = readline がアクティブになった証 → ショートカット解禁
          if (inst && !inst.shellReady) {
            inst.shellReady = true;
          }
        }
      } catch (e) {
        console.warn("[OSC 7770] handler error:", e);
      }
      return true;
    },
  );

  // OSC 7: CWD追跡（シェルが printf '\e]7;file://hostname/path\a' を送信）
  const osc7Disposable = terminal.parser.registerOscHandler(
    7,
    (data: string) => {
      try {
        // file://hostname/path 形式からパスを取得
        const match = data.match(/^file:\/\/[^/]*(\/.*)/);
        if (match) {
          const cwdPath = decodeURIComponent(match[1]);
          useTerminalMetaStore.getState().setCwd(id, cwdPath);
          window.api.recentDirs.add(cwdPath);
        }
      } catch (e) {
        console.warn("[OSC 7] handler error:", e);
      }
      return true;
    },
  );

  // プロセス名リスナー
  const processNameRemover = window.api.pty.onProcessName((event) => {
    if (event.id === id) {
      useTerminalMetaStore.getState().setProcessName(id, event.processName);
    }
  });

  // シェル名リスナー
  const shellNameRemover = window.api.pty.onShellName((event) => {
    if (event.id === id) {
      useTerminalMetaStore.getState().setShellName(id, event.shellName);
    }
  });

  // メタデータ初期化
  useTerminalMetaStore.getState().initMeta(id);

  // textareaのネイティブイベントリスナー登録（フォーカス同期 + IME composition）
  // terminal.open()後に呼ぶ必要がある（textareaはopen後に生成されるため）
  const registerTerminalListeners = (): void => {
    const textarea = terminal.element?.querySelector("textarea");
    if (textarea) {
      // フォーカスリスナー（activeTerminalId同期用）
      textarea.addEventListener("focus", () => {
        callbacks.onFocus();
      });
      textarea.addEventListener("compositionstart", () => {
        isComposing = true;
        lastCompositionData = null;
      });
      textarea.addEventListener("compositionend", (e: CompositionEvent) => {
        isComposing = false;
        // Send the confirmed text directly from compositionend event
        // This avoids relying on xterm.js's setTimeout(0) which can race with
        // the next compositionstart when macOS IME splits long compositions
        if (e.data && e.data.length > 0) {
          lastCompositionData = e.data;
          if (!isAltScreen(terminal)) {
            applyHistoryDelta(inputHistory, e.data);
          }
          callbacks.onData(e.data);
        }
      });
    }
  };

  const instance: TerminalInstance = {
    terminal,
    fitAddon,
    searchAddon,
    ptyCreated: false,
    compositionRegistered: false,
    shellReady: false,
    dataListenerRemover: () => {
      terminalDataDisposable.dispose();
      oscDisposable.dispose();
      osc7Disposable.dispose();
      processNameRemover();
      shellNameRemover();
      dataListenerRemover();
    },
    exitListenerRemover,
    inputHistory,
    promptDot: { marker: null, decoration: null },
  };

  // Store the registration function for use in attachToContainer
  (
    instance as TerminalInstance & { _registerComposition?: () => void }
  )._registerComposition = registerTerminalListeners;

  registry.set(id, instance);
  return instance;
}

/**
 * Destroy a terminal instance (only call when closing the terminal)
 */
export function destroy(id: string): void {
  const instance = registry.get(id);
  if (!instance) return;

  // Remove listeners
  if (instance.dataListenerRemover) {
    instance.dataListenerRemover();
  }
  if (instance.exitListenerRemover) {
    instance.exitListenerRemover();
  }

  // Dispose terminal
  instance.terminal.dispose();

  // メタデータのクリーンアップ
  useTerminalMetaStore.getState().removeMeta(id);
  // パス履歴ストアのクリーンアップ
  usePathHistoryStore.getState().removePane(id);

  // プロンプトドット状態のクリーンアップ（registry 削除前に instance 経由で破棄）
  instance.promptDot.decoration?.dispose();
  instance.promptDot.marker?.dispose();

  registry.delete(id);
  // サイズキャッシュのクリーンアップ
  lastSizes.delete(id);
  // 保留中の pty.resize timer をクリア（破棄済みペインへ resize IPC が飛ぶのを防ぐ）
  const pending = pendingPtyResizes.get(id);
  if (pending) {
    clearTimeout(pending.timer);
    pendingPtyResizes.delete(id);
  }
  // パス履歴バッファのクリーンアップ
  pathBuffers.delete(id);
}

/**
 * Attach terminal to a DOM container
 */
export function attachToContainer(id: string, container: HTMLElement): void {
  const instance = registry.get(id);
  if (!instance) return;

  // Check if already attached to this container
  const terminalElement = instance.terminal.element;
  if (terminalElement && terminalElement.parentElement === container) {
    return;
  }

  // If terminal was previously opened elsewhere, we need to reattach
  if (terminalElement && terminalElement.parentElement) {
    // Move the existing terminal element to the new container
    container.appendChild(terminalElement);
  } else {
    // First time opening
    instance.terminal.open(container);
  }

  // Register composition event listeners after terminal is attached to DOM
  if (!instance.compositionRegistered) {
    const registerFn = (
      instance as TerminalInstance & { _registerComposition?: () => void }
    )._registerComposition;
    if (registerFn) {
      registerFn();
      instance.compositionRegistered = true;
    }
  }
}

/**
 * Resize terminal
 */
export function resize(id: string, cols: number, rows: number): void {
  const instance = registry.get(id);
  if (!instance) return;

  instance.terminal.resize(cols, rows);
}

// 前回のサイズを保存（不要なIPCを避けるため）
const lastSizes = new Map<string, { cols: number; rows: number }>();

/**
 * fit() のサイズキャッシュを破棄する。
 * viewMode 切替や Panel.onResize の経路など「PTY 側の cols が古いまま」になり得る
 * 場面で呼ぶと、次回 fit() が同サイズでも必ず新しいサイズを返し pty.resize が走る。
 */
export function invalidateLastSize(id: string): void {
  lastSizes.delete(id);
}

// pty.resize の呼び出しをトレーリング debounce で集約する。
// 用途: ユーザがペイン境界を drag したり、CSS transition 中に ResizeObserver / Panel.onResize
// がフレーム単位で発火すると、毎フレーム pty.resize → SIGWINCH → 前面 TUI（Claude CLI 等）
// が再描画 → 古い描画が scrollback に残るループに入り、長文が縦に大量複製される。
// xterm 側の reflow（fitAddon.fit / terminal.resize）は即時実行して見た目を維持しつつ、
// PTY への通知だけ「最終サイズ」に集約することでこの再描画スパムを止める。
const PTY_RESIZE_DEBOUNCE_MS = 80;
const pendingPtyResizes = new Map<
  string,
  { cols: number; rows: number; timer: ReturnType<typeof setTimeout> }
>();

function schedulePtyResize(id: string, cols: number, rows: number): void {
  const existing = pendingPtyResizes.get(id);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pendingPtyResizes.delete(id);
    try {
      window.api.pty.resize(id, cols, rows);
    } catch {
      // window.api 未注入のテスト環境では握りつぶす
    }
  }, PTY_RESIZE_DEBOUNCE_MS);
  pendingPtyResizes.set(id, { cols, rows, timer });
}

// テスト用: pending pty.resize をすべてキャンセルする
export function cancelPendingPtyResizes(): void {
  for (const [, entry] of pendingPtyResizes) {
    clearTimeout(entry.timer);
  }
  pendingPtyResizes.clear();
}

/**
 * Fit terminal to its container
 * @returns サイズが変更された場合は新しいサイズ、変更がない場合はnull
 */
// 提案サイズがこの cols 未満なら DOM レイアウト過渡状態の異常値とみなして fit を見送る。
// xterm.js の MINIMUM_COLS=2 まで落ちると scrollback がその cols で破壊的に再 wrap され、
// 後で広い cols へ戻しても元の見た目には戻らない（reflow がロスを伴うため）。
const MIN_REASONABLE_COLS = 5;

export function fit(id: string): { cols: number; rows: number } | null {
  const instance = registry.get(id);
  if (!instance) return null;

  const tryFit = (): { cols: number; rows: number } | null => {
    try {
      // proposeDimensions で先に妥当性チェックして、異常値なら fit() を呼ばない。
      // fit() は内部で terminal.resize を呼んで scrollback を再 wrap するので、
      // 呼んだ後で「実は cols=2 だった」と判定しても手遅れになる。
      const proposed = instance.fitAddon.proposeDimensions();
      if (!proposed) return null;
      if (!Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) {
        return null;
      }
      if (proposed.cols < MIN_REASONABLE_COLS || proposed.rows <= 0) {
        return null;
      }
      instance.fitAddon.fit();
      const cols = instance.terminal.cols;
      const rows = instance.terminal.rows;
      if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
      if (cols <= 0 || rows <= 0) return null;
      return { cols, rows };
    } catch {
      return null;
    }
  };

  let newSize = tryFit();
  // 1 回目失敗時は次の rAF で 1 度だけリトライ。
  // 主に display:none → block 直後の offsetWidth=0 を救う。
  if (!newSize) {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        const retried = tryFit();
        if (!retried) return;
        const last = lastSizes.get(id);
        if (last && last.cols === retried.cols && last.rows === retried.rows) {
          return;
        }
        lastSizes.set(id, retried);
        // リトライ成功も debounce 経由で集約する（drag 中のスパム抑止）
        schedulePtyResize(id, retried.cols, retried.rows);
      });
    }
    return null;
  }

  // サイズが変わっていない場合はnullを返す（IPCを節約）
  const lastSize = lastSizes.get(id);
  if (
    lastSize &&
    lastSize.cols === newSize.cols &&
    lastSize.rows === newSize.rows
  ) {
    return null;
  }

  lastSizes.set(id, newSize);
  // PTY への通知は debounce で集約。caller の重複呼び出しは結果的に最後の 1 回に集約される。
  schedulePtyResize(id, newSize.cols, newSize.rows);
  return newSize;
}

/**
 * Focus terminal
 */
export function focus(id: string): void {
  const instance = registry.get(id);
  if (!instance) return;

  instance.terminal.focus();
}

/**
 * ターミナルのスクロールを最下部へ移動
 * ペイン切替時に呼び、ユーザーが常にプロンプト行を視認できるようにする
 */
export function scrollToBottom(id: string): void {
  const instance = registry.get(id);
  if (!instance) return;

  instance.terminal.scrollToBottom();
}

/**
 * ターミナルのテーマを更新
 */
function updateTheme(id: string, xtermTheme: XtermTheme): void {
  const instance = registry.get(id);
  if (!instance) return;

  instance.terminal.options.theme = xtermTheme;
}

/**
 * 全ターミナルのテーマを一括更新
 */
export function updateAllThemes(xtermTheme: XtermTheme): void {
  for (const [id] of registry) {
    updateTheme(id, xtermTheme);
  }
}

/**
 * カーソルがある行全体を選択
 */
export function selectCurrentLine(id: string): void {
  const instance = registry.get(id);
  if (!instance) return;

  const terminal = instance.terminal;
  const buffer = terminal.buffer.active;
  const cursorY = buffer.cursorY + buffer.viewportY;

  terminal.selectLines(cursorY, cursorY);
}

/**
 * シェルの readline (zle/bash) がアクティブかを判定する。
 * 起動直後は canonical mode のため、Ctrl+A 等を送ると ^A と echo されてしまう。
 * 初回 OSC 7770;A 受信で true。シェル統合 OSC が来ない構成では永久に false。
 */
export function isShellReady(id: string): boolean {
  const instance = registry.get(id);
  if (!instance) return false;
  return instance.shellReady;
}

/**
 * 履歴記録を伴う PTY 書き込み。ショートカットから制御シーケンスを送る場合に使う。
 * （通常のキー入力は terminal.onData 経由で自動的に履歴に入る）
 * シェル起動中は silent suppress する（^X echo を防ぐ）。
 */
export function writeWithHistory(id: string, payload: string): void {
  const instance = registry.get(id);
  if (!instance) return;
  if (!instance.shellReady) return;
  if (!isAltScreen(instance.terminal)) {
    applyHistoryDelta(instance.inputHistory, payload);
  }
  window.api.pty.write(id, payload);
}

/**
 * Undo: 直前の行状態を PTY に再入力する
 * ALT screen（TUI）中は no-op
 */
export function undo(id: string): boolean {
  const instance = registry.get(id);
  if (!instance) return false;
  if (!instance.shellReady) return false;
  if (isAltScreen(instance.terminal)) return false;
  // 前面プロセスが claude / node / vim 等の非シェルなら no-op（暴発防止）
  if (!isReadlineActive(id)) return false;

  const history = instance.inputHistory;
  if (history.undoStack.length === 0) return false;

  const previous = history.undoStack.pop() as string;
  history.redoStack.push(history.currentLine);
  history.currentLine = previous;

  // 現在行をクリア（Ctrl+E で行末 → Ctrl+U で行頭まで削除）して前状態を打ち直す
  window.api.pty.write(id, "\x05\x15");
  if (previous.length > 0) {
    window.api.pty.write(id, previous);
  }
  return true;
}

/**
 * SearchAddon: 検索ナビゲーション
 * - findNext / findPrevious は SearchAddon の検索ハイライトを移動
 * - clearSearchDecorations は装飾を消す（オーバーレイ閉じ時）
 * - subscribeSearchResults はヒット件数（resultIndex/resultCount）の更新を通知
 */
const SEARCH_DECORATIONS = {
  matchBackground: "#5a4a00",
  matchBorder: "#ffd866",
  matchOverviewRuler: "#ffd866",
  activeMatchBackground: "#a07000",
  activeMatchBorder: "#ffd866",
  activeMatchColorOverviewRuler: "#ffd866",
} as const;

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  // findNext のみ有効。現在の選択範囲が新しい term にもマッチしている間は移動しない
  incremental?: boolean;
}

function buildSearchOptions(options?: SearchOptions): ISearchOptions {
  return {
    caseSensitive: options?.caseSensitive ?? false,
    wholeWord: options?.wholeWord ?? false,
    regex: options?.regex ?? false,
    incremental: options?.incremental ?? false,
    decorations: SEARCH_DECORATIONS,
  };
}

export function findNext(
  id: string,
  query: string,
  options?: SearchOptions,
): boolean {
  const instance = registry.get(id);
  if (!instance || query.length === 0) return false;
  return instance.searchAddon.findNext(query, buildSearchOptions(options));
}

export function findPrevious(
  id: string,
  query: string,
  options?: SearchOptions,
): boolean {
  const instance = registry.get(id);
  if (!instance || query.length === 0) return false;
  return instance.searchAddon.findPrevious(query, buildSearchOptions(options));
}

export function clearSearchDecorations(id: string): void {
  const instance = registry.get(id);
  if (!instance) return;
  instance.searchAddon.clearDecorations();
}

/**
 * スクロールバックを全消去する（プロンプト行は保持）。
 * - terminal.clear(): バッファ全体を削除し、現在のプロンプト行を新しい先頭行にする
 *   （PTY プロセス・シェル状態は触らないため、実行中のコマンドや履歴は保持）
 * - clearTextureAtlas(): canvas renderer のテクスチャ腐敗（macOS スリープ復帰時の
 *   表示崩れ等）を強制再描画でリセット
 *
 * 大量出力で重くなったときや、文字化け/表示崩れを直したいときに使う。
 * 部分削除は trimScrollback を、xterm 状態の完全初期化は resetTerminal を参照。
 */
export function clearScrollback(id: string): void {
  const instance = registry.get(id);
  if (!instance) return;
  instance.terminal.clear();
  instance.terminal.clearTextureAtlas();
}

/**
 * スクロールバックを「直近 keepLines 行」まで縮める。
 * - xterm.js の `scrollback` オプションを一時的に keepLines に下げると、
 *   内部 BufferService が古い行から trim する（v5.5.x で確認済の挙動）
 * - trim 発火直後に microtask で元の上限へ戻し、今後の出力が再び 10000 行まで
 *   蓄積できるようにする（恒久的な上限変更ではない）
 * - keepLines が現在上限以上 / 負数 / NaN なら no-op
 *
 * シェル状態 / PTY プロセスには触らない（clearScrollback と同じ）。
 */
export function trimScrollback(id: string, keepLines: number): void {
  const instance = registry.get(id);
  if (!instance) return;
  if (!Number.isFinite(keepLines) || keepLines < 0) return;
  const original = instance.terminal.options.scrollback ?? 10000;
  if (keepLines >= original) return;
  instance.terminal.options.scrollback = keepLines;
  instance.terminal.clearTextureAtlas();
  queueMicrotask(() => {
    // ペイン破棄レース対策: registry から差し替えられていたら触らない
    if (registry.get(id) !== instance) return;
    instance.terminal.options.scrollback = original;
  });
}

/**
 * xterm の Bell イベントを購読する。シェルが \a (BEL) を出すと呼ばれる。
 * 戻り値の関数で unsubscribe する。
 */
export function subscribeBell(id: string, listener: () => void): () => void {
  const instance = registry.get(id);
  if (!instance) return () => {};
  const disposable = instance.terminal.onBell(listener);
  return () => disposable.dispose();
}

/**
 * xterm のオプションを部分的に更新する。fontSize / lineHeight / fontFamily 等
 * セルサイズに影響するキーを変更した場合は fit() を実行して PTY 側にもリサイズを伝える。
 *
 * @returns fit() でサイズが変わった場合は新しい cols/rows、それ以外は null
 */
export function applyOptions(
  id: string,
  options: Partial<ITerminalOptions>,
): { cols: number; rows: number } | null {
  const instance = registry.get(id);
  if (!instance) return null;
  const t = instance.terminal;

  // セルサイズに影響するキー
  const SIZE_AFFECTING: ReadonlySet<keyof ITerminalOptions> = new Set([
    "fontSize",
    "fontFamily",
    "fontWeight",
    "fontWeightBold",
    "letterSpacing",
    "lineHeight",
  ]);
  let needsResize = false;

  for (const key of Object.keys(options) as (keyof ITerminalOptions)[]) {
    const value = options[key];
    if (value === undefined) continue;
    // ITerminalOptions の動的代入は型的にユニオンで弾かれるため、unknown 経由で代入
    (t.options as unknown as Record<string, unknown>)[key] = value as unknown;
    if (SIZE_AFFECTING.has(key)) needsResize = true;
  }

  if (needsResize) {
    invalidateLastSize(id);
    return fit(id);
  }
  return null;
}

/**
 * xterm 側の状態を完全初期化する。
 * - terminal.reset(): カーソル形状、モード、代替バッファ、選択、スクロールバックを全リセット
 * - PTY プロセス・シェル状態には触らない（実行中コマンドや環境は保持）
 * - 用途: クリアでも直らない表示崩れ、TUI を抜けた直後にカーソルが戻らない時の最終手段
 */
export function resetTerminal(id: string): void {
  const instance = registry.get(id);
  if (!instance) return;
  instance.terminal.reset();
  instance.terminal.clearTextureAtlas();
}

export interface SearchResultInfo {
  resultIndex: number;
  resultCount: number;
}

/**
 * SearchAddon の onDidChangeResults を購読する。
 * 戻り値の関数で unsubscribe する。
 */
export function subscribeSearchResults(
  id: string,
  listener: (info: SearchResultInfo) => void,
): () => void {
  const instance = registry.get(id);
  if (!instance) return () => {};
  const disposable = instance.searchAddon.onDidChangeResults(listener);
  return () => disposable.dispose();
}

/**
 * パス履歴抽出
 * - PTY 出力チャンクをペインごとに小さなバッファに溜め、改行ごとに 1 行として走査
 * - 絶対 (`/...`, `~/...`) と相対 (`./...`, `../...`, `<word>/<word>`) を別々のパターンで拾う
 * - 相対は CWD と組み合わせて絶対化したものも履歴に積む（重複は store 側で dedup）
 * - ANSI エスケープは目視ノイズにしかならないため、抽出時に除去
 */
const pathBuffers = new Map<string, string>();
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][AB012]/g;

// セミコロン・カンマ等で囲まれた `path:line:col` も拾うため、終端は空白系まで広めに取る
// `:NN` 末尾は履歴側でファイルとして扱えるように残す
const ABS_PATH_RE = /(?:^|[\s'"`(<\[])((?:~|\/)[A-Za-z0-9._\-/@~+%]+)/g;
const REL_PATH_RE =
  /(?:^|[\s'"`(<\[])((?:\.{1,2}\/|[A-Za-z0-9_.-]+\/)[A-Za-z0-9._\-/@+%]+)/g;

function feedPathHistory(id: string, chunk: string): void {
  const cleaned = chunk.replace(ANSI_PATTERN, "");
  const buf = (pathBuffers.get(id) ?? "") + cleaned;
  const newlineIdx = buf.lastIndexOf("\n");
  if (newlineIdx === -1) {
    // 改行がまだ来ていない → 次のチャンクへ持ち越し（暴走防止に上限）
    pathBuffers.set(id, buf.length > 8192 ? buf.slice(-4096) : buf);
    return;
  }
  const lines = buf.slice(0, newlineIdx).split("\n");
  pathBuffers.set(id, buf.slice(newlineIdx + 1));

  const cwd = useTerminalMetaStore.getState().metas.get(id)?.cwd ?? null;
  const store = usePathHistoryStore.getState();
  for (const line of lines) {
    if (line.length === 0 || line.length > 4096) continue;
    extractPaths(line, cwd, (raw, kind) => {
      store.addPath(id, raw, kind);
    });
  }
}

function extractPaths(
  line: string,
  cwd: string | null,
  emit: (raw: string, kind: "absolute" | "relative") => void,
): void {
  ABS_PATH_RE.lastIndex = 0;
  REL_PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ABS_PATH_RE.exec(line)) !== null) {
    emit(stripTrailingPunct(match[1]), "absolute");
  }
  if (cwd) {
    while ((match = REL_PATH_RE.exec(line)) !== null) {
      const raw = stripTrailingPunct(match[1]);
      // 拡張子なしの単一識別子（例: `foo/bar`）も含むが、`http://`等は除外したい
      if (!/^https?:\/\//.test(raw)) {
        emit(raw, "relative");
      }
    }
  }
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[)>\].,;:!?'"`]+$/, "");
}

export function clearPathBuffer(id: string): void {
  pathBuffers.delete(id);
}

/**
 * Redo: Undo で戻した状態を復元する
 */
export function redo(id: string): boolean {
  const instance = registry.get(id);
  if (!instance) return false;
  if (!instance.shellReady) return false;
  if (isAltScreen(instance.terminal)) return false;
  if (!isReadlineActive(id)) return false;

  const history = instance.inputHistory;
  if (history.redoStack.length === 0) return false;

  const next = history.redoStack.pop() as string;
  history.undoStack.push(history.currentLine);
  if (history.undoStack.length > MAX_UNDO_STACK_SIZE) {
    history.undoStack.shift();
  }
  history.currentLine = next;

  window.api.pty.write(id, "\x05\x15");
  if (next.length > 0) {
    window.api.pty.write(id, next);
  }
  return true;
}
