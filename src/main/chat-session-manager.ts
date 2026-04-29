import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { BrowserWindow } from "electron";
import * as fs from "fs";
import * as os from "os";
import { resolveClaudeBinary } from "./cli-resolver";
import { getMergedPath } from "./shell-integration";
import type { ChatEventEnvelope } from "../shared/chat-events";

// stream-json の 1 行 (= 1 JSONL イベント) は通常数 KB だが、長い tool_result が来ると
// 数十 KB に達することがある。1 行 1MB を超えたら異常としてセッションを停止する。
const MAX_LINE_BYTES = 1 * 1024 * 1024;

interface ChatSession {
  paneId: string;
  windowId: number;
  child: ChildProcessWithoutNullStreams;
  cwd: string;
  sessionId: string | null;
  status: "starting" | "ready" | "error" | "closed";
  // stdout の不完全行バッファ
  stdoutBuf: string;
  // stderr の集約バッファ（エラー時に Renderer に転送する）
  stderrBuf: string;
}

export interface ChatStartResult {
  ok: boolean;
  sessionId?: string;
  error?: string;
}

class ChatSessionManager {
  private sessions: Map<string, ChatSession> = new Map();
  private windows: Map<number, BrowserWindow> = new Map();

  registerWindow(windowId: number, win: BrowserWindow): void {
    this.windows.set(windowId, win);
  }

  unregisterWindow(windowId: number): void {
    this.windows.delete(windowId);
  }

  /**
   * 指定ペインに対して claude プロセスを spawn する。
   * 既にセッションがある場合は上書きせず ok: false を返す（呼び出し側は dispose してから再起動する）。
   */
  start(
    paneId: string,
    windowId: number,
    cwd: string,
    options: { resumeSessionId?: string },
  ): ChatStartResult {
    if (this.sessions.has(paneId)) {
      return { ok: false, error: "session_already_started" };
    }

    const claudeBin = resolveClaudeBinary();
    if (!claudeBin) {
      return { ok: false, error: "claude_binary_not_found" };
    }

    // CWD が存在しない場合は HOME にフォールバック（PTY と同じ挙動）
    const safeCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir();

    // 新規 / resume の判別。明示的に session-id を持たせる（new uuid）か resume するか。
    // どちらも一意な session_id をクライアント側が把握できる前提で IPC を組む。
    const args: string[] = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
    ];
    let initialSessionId: string | null = null;
    if (options.resumeSessionId) {
      args.push("--resume", options.resumeSessionId);
      initialSessionId = options.resumeSessionId;
    } else {
      const newId = generateUuid();
      args.push("--session-id", newId);
      initialSessionId = newId;
    }

    // 環境変数: 危険な動的注入系を除去 + PATH を解決済みのものに置換 + 日本語ロケール固定。
    const DANGEROUS_ENV_KEYS = new Set([
      "NODE_OPTIONS",
      "LD_PRELOAD",
      "DYLD_INSERT_LIBRARIES",
      "DYLD_LIBRARY_PATH",
    ]);
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("npm_") && !DANGEROUS_ENV_KEYS.has(key),
      ),
    ) as Record<string, string>;
    const env: Record<string, string> = {
      ...cleanEnv,
      PATH: getMergedPath(),
      LANG: "ja_JP.UTF-8",
      LC_ALL: "ja_JP.UTF-8",
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(claudeBin, args, {
        cwd: safeCwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `spawn_failed: ${message}` };
    }

    const session: ChatSession = {
      paneId,
      windowId,
      child,
      cwd: safeCwd,
      sessionId: initialSessionId,
      status: "starting",
      stdoutBuf: "",
      stderrBuf: "",
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      this.handleStdoutChunk(session, chunk);
    });

    child.stderr.on("data", (chunk: string) => {
      // stderr は基本的に異常時のみ流れる。集約してエラー時に同梱する。
      session.stderrBuf += chunk;
      // バッファが膨れすぎないよう適度に切り詰める
      if (session.stderrBuf.length > 64 * 1024) {
        session.stderrBuf = session.stderrBuf.slice(-32 * 1024);
      }
    });

    child.on("error", (err) => {
      this.pushEvent(session, {
        type: "error",
        message: `process_error: ${err.message}`,
      });
      session.status = "error";
    });

    child.on("exit", (code) => {
      // stderr に残っていれば一度 error として通知する（認証失敗等の追加情報）
      if (session.stderrBuf.trim().length > 0) {
        this.pushEvent(session, {
          type: "error",
          message: session.stderrBuf.trim(),
        });
      }
      this.pushEvent(session, { type: "end", exitCode: code });
      session.status = "closed";
      this.sessions.delete(paneId);
    });

    this.sessions.set(paneId, session);
    return { ok: true, sessionId: initialSessionId ?? undefined };
  }

  /**
   * ユーザー入力を JSONL として stdin に流す。改行付きの 1 行として送信。
   */
  write(paneId: string, content: string): boolean {
    const session = this.sessions.get(paneId);
    if (!session || session.status === "closed") return false;
    if (typeof content !== "string" || content.length === 0) return false;

    const payload = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: content }],
      },
    };
    const line = JSON.stringify(payload) + "\n";
    try {
      session.child.stdin.write(line);
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.pushEvent(session, {
        type: "error",
        message: `write_failed: ${message}`,
      });
      return false;
    }
  }

  /**
   * 現在のターンを停止する（プロセスごと kill）。session_id は保持されるので resume で続けられる。
   * dispose と異なり、Renderer 側の chat session entry はそのまま残してよい。
   */
  stop(paneId: string): void {
    const session = this.sessions.get(paneId);
    if (!session) return;
    try {
      session.child.kill("SIGTERM");
    } catch {
      // 既に死んでいる
    }
  }

  /**
   * セッションを完全に破棄する。stop + Map から削除（exit ハンドラで Map 削除されるが念押し）。
   */
  dispose(paneId: string): void {
    const session = this.sessions.get(paneId);
    if (!session) return;
    try {
      session.child.kill("SIGTERM");
    } catch {
      // ignore
    }
    this.sessions.delete(paneId);
  }

  /**
   * 現在の session_id を返す。CLI ↔ Chat 切替時の `--resume` 引数に使う。
   */
  getSessionId(paneId: string): string | null {
    return this.sessions.get(paneId)?.sessionId ?? null;
  }

  killAllForWindow(windowId: number): void {
    for (const [paneId, session] of this.sessions) {
      if (session.windowId === windowId) {
        try {
          session.child.kill("SIGTERM");
        } catch {
          // ignore
        }
        this.sessions.delete(paneId);
      }
    }
  }

  killAll(): void {
    for (const [, session] of this.sessions) {
      try {
        session.child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    this.sessions.clear();
  }

  // ===== 内部 =====

  private handleStdoutChunk(session: ChatSession, chunk: string): void {
    session.stdoutBuf += chunk;
    if (session.stdoutBuf.length > MAX_LINE_BYTES) {
      // 1 行が異常に大きい → セッションを停止する
      this.pushEvent(session, {
        type: "error",
        message: "stdout_line_too_large",
      });
      try {
        session.child.kill("SIGTERM");
      } catch {
        // ignore
      }
      session.stdoutBuf = "";
      return;
    }

    // 改行で分割し、最後の不完全行は次回まで持ち越す
    const lines = session.stdoutBuf.split("\n");
    session.stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      this.handleJsonLine(session, trimmed);
    }
  }

  private handleJsonLine(session: ChatSession, line: string): void {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // パース不能行は無視（hook 経由の生 stdout 等）
      return;
    }
    const type = String(obj.type ?? "");

    // session_id を最初に観測したタイミングで Renderer に通知
    const incomingSid =
      typeof obj.session_id === "string" ? obj.session_id : null;
    if (incomingSid && session.sessionId !== incomingSid) {
      session.sessionId = incomingSid;
      this.pushEvent(session, { type: "session.id", sessionId: incomingSid });
    }
    if (incomingSid && session.status === "starting") {
      session.status = "ready";
    }

    // 認証エラーの早期検出: assistant.error === "authentication_failed"
    if (type === "assistant") {
      const err = obj.error;
      if (typeof err === "string" && err === "authentication_failed") {
        this.pushEvent(session, {
          type: "error",
          message: "authentication_failed",
          payload: obj,
        });
      }
    }

    switch (type) {
      case "system":
        this.pushEvent(session, { type: "system", payload: obj });
        break;
      case "assistant":
        this.pushEvent(session, { type: "assistant", payload: obj });
        break;
      case "user":
        this.pushEvent(session, { type: "user", payload: obj });
        break;
      case "stream_event":
        this.pushEvent(session, { type: "stream", payload: obj });
        break;
      case "result":
        this.pushEvent(session, { type: "result", payload: obj });
        break;
      case "rate_limit_event":
        this.pushEvent(session, { type: "rate_limit", payload: obj });
        break;
      default:
        // 未知 type は warn を残しつつ system として転送（Phase 0 003 の Lessons 4 番目）
        this.pushEvent(session, { type: "system", payload: obj });
        break;
    }
  }

  private pushEvent(session: ChatSession, event: ChatEventEnvelope): void {
    const win = this.windows.get(session.windowId);
    if (!win || win.isDestroyed()) return;
    win.webContents.send("chat:event", { paneId: session.paneId, event });
  }
}

// 簡易 UUID v4 生成。Node 22+ なら crypto.randomUUID が使えるはずだが、
// Electron バージョンの揺れに耐えるように crypto モジュール経由で取得。
function generateUuid(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto") as typeof import("crypto");
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // フォールバック（4.4 以前など）
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export const chatSessionManager = new ChatSessionManager();
