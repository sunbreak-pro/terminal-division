import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { claudeProcessDetector } from "../claude-process-detector";

// 最小限の BrowserWindow モック（webContents.send / isDestroyed のみ）
function makeWindow(): {
  win: BrowserWindow;
  send: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn();
  const isDestroyed = vi.fn().mockReturnValue(false);
  const win = {
    webContents: { send },
    isDestroyed,
  } as unknown as BrowserWindow;
  return { win, send, isDestroyed };
}

// 起動マーカー: ESC ] 0 ; ✳ Claude Code BEL
// バイト列で正しい表現にするには UTF-8 文字列で組み立てる（Phase 0 検証で確認済）
const FULL_BANNER = "\x1b]0;✳ Claude Code\x07";

describe("claudeProcessDetector", () => {
  beforeEach(() => {
    // detector のグローバル状態をリセット
    claudeProcessDetector.reset("p1");
    claudeProcessDetector.reset("p2");
    claudeProcessDetector.unregisterWindow(100);
    claudeProcessDetector.unregisterWindow(200);
  });

  it("emits chat:claudeDetected on full banner in a single chunk", () => {
    const { win, send } = makeWindow();
    claudeProcessDetector.registerWindow(100, win);
    claudeProcessDetector.feedChunk("p1", 100, FULL_BANNER);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("chat:claudeDetected", { paneId: "p1" });
  });

  it("detects across chunk boundary using ring buffer", () => {
    const { win, send } = makeWindow();
    claudeProcessDetector.registerWindow(100, win);
    // 「]0;✳ Claude Code\x07」を 2 chunk に分割（境界はマーカーの真ん中）
    const head = "\x1b]0;✳ Cla";
    const tail = "ude Code\x07 some-other-output";
    claudeProcessDetector.feedChunk("p1", 100, head);
    expect(send).not.toHaveBeenCalled();
    claudeProcessDetector.feedChunk("p1", 100, tail);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("chat:claudeDetected", { paneId: "p1" });
  });

  it("does not double-emit for the same pane after detection", () => {
    const { win, send } = makeWindow();
    claudeProcessDetector.registerWindow(100, win);
    claudeProcessDetector.feedChunk("p1", 100, FULL_BANNER);
    claudeProcessDetector.feedChunk("p1", 100, FULL_BANNER);
    claudeProcessDetector.feedChunk("p1", 100, "more output...");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("emits per pane independently", () => {
    const { win, send } = makeWindow();
    claudeProcessDetector.registerWindow(100, win);
    claudeProcessDetector.feedChunk("p1", 100, FULL_BANNER);
    claudeProcessDetector.feedChunk("p2", 100, FULL_BANNER);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, "chat:claudeDetected", {
      paneId: "p1",
    });
    expect(send).toHaveBeenNthCalledWith(2, "chat:claudeDetected", {
      paneId: "p2",
    });
  });

  it("re-detects after reset(paneId)", () => {
    const { win, send } = makeWindow();
    claudeProcessDetector.registerWindow(100, win);
    claudeProcessDetector.feedChunk("p1", 100, FULL_BANNER);
    expect(send).toHaveBeenCalledTimes(1);
    // PTY 再起動を想定して reset
    claudeProcessDetector.reset("p1");
    claudeProcessDetector.feedChunk("p1", 100, FULL_BANNER);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does NOT match generic shell output that lacks Claude markers", () => {
    const { win, send } = makeWindow();
    claudeProcessDetector.registerWindow(100, win);
    // 似ているが該当しない (OSC 0 + 別タイトル)
    claudeProcessDetector.feedChunk("p1", 100, "\x1b]0;bash\x07$ ls -la\n");
    expect(send).not.toHaveBeenCalled();
  });

  it("matches fallback pattern (OSC 0 + 'Claude Code\\x07') even without ✳", () => {
    const { win, send } = makeWindow();
    claudeProcessDetector.registerWindow(100, win);
    // 絵文字差し替え等で ✳ が消えても、OSC 0 タイトルの `Claude Code` 直後に BEL が
    // ある（= ウィンドウタイトルが終端した）パターンなら fallback で検出される。
    // 誤検出回避のため `Claude Code` 単独ではなく BEL 直後を要求する設計。
    claudeProcessDetector.feedChunk("p1", 100, "\x1b]0;Claude Code\x07$ ready");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when window is unregistered (no crash)", () => {
    // window を登録せずに feedChunk するだけ。検出はされても push 先がない → no-op
    expect(() => {
      claudeProcessDetector.feedChunk("p1", 999, FULL_BANNER);
    }).not.toThrow();
  });

  it("does not push to a destroyed window", () => {
    const { win, send, isDestroyed } = makeWindow();
    claudeProcessDetector.registerWindow(100, win);
    isDestroyed.mockReturnValue(true);
    claudeProcessDetector.feedChunk("p1", 100, FULL_BANNER);
    expect(send).not.toHaveBeenCalled();
  });

  it("unregisterWindow clears all per-pane states for that window", () => {
    const { win, send } = makeWindow();
    claudeProcessDetector.registerWindow(100, win);
    // p1 のリングバッファに途中まで詰める
    claudeProcessDetector.feedChunk("p1", 100, "\x1b]0;✳ Cla");
    claudeProcessDetector.unregisterWindow(100);
    // 別ウィンドウで再登録 → 同 paneId でも前のリングバッファが消えているので
    // 「ude Code\x07」だけでは検出されない（前半が無いため）
    const win2 = makeWindow();
    claudeProcessDetector.registerWindow(200, win2.win);
    claudeProcessDetector.feedChunk("p1", 200, "ude Code\x07");
    expect(win2.send).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
