import { BrowserWindow } from "electron";

// claude TUI が起動直後に必ず emit する OSC 0 ウィンドウタイトルマーカー。
// バイト列は ESC ] 0 ; ✳ Claude Code BEL（✳ は U+2733 = UTF-8: e2 9c b3）。
// 検出は文字列単純検索で十分（PTY は string で渡ってくる前提）。
const CLAUDE_BANNER_MARKER = "\x1b]0;✳ Claude Code\x07";
// 念のため絵文字なしでマッチするための代替パターン (将来 CLI バージョンで絵文字が変わる
// 可能性に備えた防衛). 厳格な誤検出を避けるため "]0;" + "Claude Code" + BEL を要求する。
const CLAUDE_BANNER_FALLBACK_PREFIX = "\x1b]0;";
const CLAUDE_BANNER_FALLBACK_TEXT = "Claude Code\x07";

interface DetectorState {
  paneId: string;
  windowId: number;
  // 最近の chunk 末尾を一定量保持して、マーカーが chunk 境界を跨いだ場合に取りこぼさないようにする。
  // OSC タイトル全体は数十バイトなので 256 バイトで十分。
  ringBuffer: string;
  detected: boolean;
}

const RING_BUFFER_LIMIT = 256;

class ClaudeProcessDetector {
  private states: Map<string, DetectorState> = new Map();
  private windows: Map<number, BrowserWindow> = new Map();

  registerWindow(windowId: number, win: BrowserWindow): void {
    this.windows.set(windowId, win);
  }

  unregisterWindow(windowId: number): void {
    this.windows.delete(windowId);
    for (const [paneId, state] of this.states) {
      if (state.windowId === windowId) {
        this.states.delete(paneId);
      }
    }
  }

  /**
   * pty-manager の onData hook から呼ばれる。chunk 内に claude 起動マーカーが見つかれば
   * Renderer に push する。一度検出した paneId は二度通知しない（PTY 上で claude を再起動した場合は
   * `reset(paneId)` を別途呼ぶ仕様）。
   */
  feedChunk(paneId: string, windowId: number, chunk: string): void {
    let state = this.states.get(paneId);
    if (!state) {
      state = {
        paneId,
        windowId,
        ringBuffer: "",
        detected: false,
      };
      this.states.set(paneId, state);
    }
    if (state.detected) return;

    // chunk 境界跨ぎを防ぐため、リングバッファの末尾と新 chunk を結合してから検索
    const haystack = state.ringBuffer + chunk;
    if (this.containsClaudeBanner(haystack)) {
      state.detected = true;
      this.pushDetected(state);
      return;
    }

    // 末尾だけ持ち越す
    if (haystack.length > RING_BUFFER_LIMIT) {
      state.ringBuffer = haystack.slice(-RING_BUFFER_LIMIT);
    } else {
      state.ringBuffer = haystack;
    }
  }

  /**
   * ペインが破棄されたとき、または claude プロセスが PTY 上で kill されて再起動されたときに呼ぶ。
   * 次の起動を再度検出できるようにする。
   */
  reset(paneId: string): void {
    this.states.delete(paneId);
  }

  private containsClaudeBanner(haystack: string): boolean {
    if (haystack.includes(CLAUDE_BANNER_MARKER)) return true;
    // フォールバック: OSC 0 開始 + どこかに "Claude Code\x07" がある場合
    // （絵文字差し替えに耐えるが、関係ない出力との誤検出を最小化するため両方の存在を要求）
    if (
      haystack.includes(CLAUDE_BANNER_FALLBACK_PREFIX) &&
      haystack.includes(CLAUDE_BANNER_FALLBACK_TEXT)
    ) {
      return true;
    }
    return false;
  }

  private pushDetected(state: DetectorState): void {
    const win = this.windows.get(state.windowId);
    if (!win || win.isDestroyed()) return;
    win.webContents.send("chat:claudeDetected", { paneId: state.paneId });
  }
}

export const claudeProcessDetector = new ClaudeProcessDetector();
