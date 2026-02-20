import { Terminal, ITerminalOptions, IMarker, IDecoration } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTerminalMetaStore } from "../stores/terminalMetaStore";

export interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  ptyCreated: boolean;
  compositionRegistered: boolean;
  dataListenerRemover: (() => void) | null;
  exitListenerRemover: (() => void) | null;
}

// Module-scope registry (independent of React lifecycle)
const registry = new Map<string, TerminalInstance>();

// プロンプトドットの状態管理（ターミナルID毎）
// シェルからOSC 7770シーケンスを受信し、マーカー+デコレーションでドット色を制御
interface PromptDotState {
  marker: IMarker | null; // 現在のプロンプト行マーカー
  decoration: IDecoration | null; // 色変更用デコレーション
}
const promptDotStates = new Map<string, PromptDotState>();

export interface TerminalCallbacks {
  onData: (data: string) => void;
  onExit: () => void;
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

  // IME composition state tracking
  // When composing (e.g., typing Japanese), macOS IME may split long compositions
  // and xterm.js may fire onData with partial text. We skip those to prevent corruption.
  let isComposing = false;
  // Track data sent via compositionend to prevent double-sending
  // (xterm.js sends the same data via setTimeout(0) after compositionend)
  let lastCompositionData: string | null = null;

  // Register terminal.onData listener ONCE during instance creation
  const terminalDataDisposable = terminal.onData((data) => {
    console.log(
      "[onData] isComposing:",
      isComposing,
      "lastCompositionData:",
      lastCompositionData ? JSON.stringify(lastCompositionData) : null,
      "data:",
      JSON.stringify(data),
    );

    // Non-ASCII characters during IME composition are handled by compositionend only.
    // Skip them here to prevent double-send or corruption during long IME compositions.
    // But allow non-ASCII when NOT composing (e.g., paste operations).
    if (isComposing && /[^\x00-\x7F]/.test(data)) {
      console.log("[onData] SKIPPED (non-ASCII during composition)");
      return;
    }

    // Skip if this data was already sent via compositionend (prevent double-send)
    if (lastCompositionData !== null && data === lastCompositionData) {
      lastCompositionData = null;
      console.log("[onData] SKIPPED (duplicate of compositionend)");
      return;
    }
    lastCompositionData = null;

    console.log("[onData] SENT");
    callbacks.onData(data);
  });

  // Register IPC listeners ONCE during instance creation
  const dataListenerRemover = window.api.pty.onData((event) => {
    if (event.id === id) {
      terminal.write(event.data);
    }
  });

  const exitListenerRemover = window.api.pty.onExit((event) => {
    if (event.id === id) {
      callbacks.onExit();
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
          const state = promptDotStates.get(id);
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
          const marker = terminal.registerMarker(0);
          if (marker) {
            promptDotStates.set(id, { marker, decoration: null });
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

  // Function to register composition event listeners on the textarea
  const registerCompositionListeners = (): void => {
    const textarea = terminal.element?.querySelector("textarea");
    if (textarea) {
      textarea.addEventListener("compositionstart", () => {
        console.log("[compositionstart]");
        isComposing = true;
        lastCompositionData = null;
      });
      textarea.addEventListener("compositionupdate", (e: CompositionEvent) => {
        console.log("[compositionupdate] data:", JSON.stringify(e.data));
      });
      textarea.addEventListener("compositionend", (e: CompositionEvent) => {
        console.log("[compositionend] data:", JSON.stringify(e.data));
        isComposing = false;
        // Send the confirmed text directly from compositionend event
        // This avoids relying on xterm.js's setTimeout(0) which can race with
        // the next compositionstart when macOS IME splits long compositions
        if (e.data && e.data.length > 0) {
          lastCompositionData = e.data;
          console.log("[compositionend] SENDING:", JSON.stringify(e.data));

          callbacks.onData(e.data);
        }
      });
    }
  };

  const instance: TerminalInstance = {
    terminal,
    fitAddon,
    ptyCreated: false,
    compositionRegistered: false,
    dataListenerRemover: () => {
      terminalDataDisposable.dispose();
      oscDisposable.dispose();
      osc7Disposable.dispose();
      processNameRemover();
      shellNameRemover();
      dataListenerRemover();
    },
    exitListenerRemover,
  };

  // Store the registration function for use in attachToContainer
  (
    instance as TerminalInstance & { _registerComposition?: () => void }
  )._registerComposition = registerCompositionListeners;

  registry.set(id, instance);
  return instance;
}

/**
 * Get an existing terminal instance
 */
export function get(id: string): TerminalInstance | undefined {
  return registry.get(id);
}

/**
 * Check if a terminal instance exists
 */
export function has(id: string): boolean {
  return registry.has(id);
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

  registry.delete(id);
  // サイズキャッシュのクリーンアップ
  lastSizes.delete(id);
  // プロンプトドット状態のクリーンアップ
  const dotState = promptDotStates.get(id);
  if (dotState) {
    dotState.decoration?.dispose();
    dotState.marker?.dispose();
    promptDotStates.delete(id);
  }
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
 * Detach terminal from its current container (does NOT dispose)
 */
export function detachFromContainer(id: string): void {
  const instance = registry.get(id);
  if (!instance) return;

  // We don't remove from DOM here - just disconnect observers etc.
  // The terminal element stays where it is until reattached or destroyed
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
 * Fit terminal to its container
 * @returns サイズが変更された場合は新しいサイズ、変更がない場合はnull
 */
export function fit(id: string): { cols: number; rows: number } | null {
  const instance = registry.get(id);
  if (!instance) return null;

  try {
    instance.fitAddon.fit();
    const newSize = {
      cols: instance.terminal.cols,
      rows: instance.terminal.rows,
    };

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
    return newSize;
  } catch {
    return null;
  }
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
 * ターミナルのテーマを更新
 */
export function updateTheme(
  id: string,
  xtermTheme: Record<string, string>,
): void {
  const instance = registry.get(id);
  if (!instance) return;

  instance.terminal.options.theme = xtermTheme;
}

/**
 * 全ターミナルのテーマを一括更新
 */
export function updateAllThemes(xtermTheme: Record<string, string>): void {
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
 * 選択テキストを取得
 */
export function getSelection(id: string): string {
  const instance = registry.get(id);
  if (!instance) return "";
  return instance.terminal.getSelection();
}

/**
 * 選択をクリア
 */
export function clearSelection(id: string): void {
  const instance = registry.get(id);
  if (!instance) return;
  instance.terminal.clearSelection();
}
