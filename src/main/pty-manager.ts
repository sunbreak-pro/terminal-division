import * as pty from "node-pty";
import { BrowserWindow } from "electron";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import {
  getShellIntegrationEnv,
  getShellArgs,
  getMergedPath,
  cleanup as cleanupShellIntegration,
} from "./shell-integration";

// チャンク分割送信用の定数
const CHUNK_SIZE = 1024; // 1KB単位で分割
const CHUNK_DELAY = 10; // チャンク間10ms遅延
const LARGE_PASTE_THRESHOLD = 512; // この閾値以上でチャンク処理

// 起動直後の出力を一時保持するバッファ上限。これを超えたら自動 flush して通常モードに切り替える。
// zsh の起動メッセージ + 初回プロンプト程度なら数 KB に収まる想定。
const INITIAL_BUFFER_LIMIT = 64 * 1024;

interface PtyProcess {
  pty: pty.IPty;
  id: string;
  windowId: number;
  processNameInterval: ReturnType<typeof setInterval> | null;
  shellName: string;
  // spawn 直後の出力を保持。renderer の pty:data リスナーは getOrCreate で同期登録
  // されるが、IPC 経路の都合で `pty:create` invoke の reply より先に Main 側 onData が
  // 発火するケースがあり、最初のチャンクが取りこぼされる懸念がある。
  // renderer は pty:create の reply 直後に flushInitialBuffer を呼び、ここに溜まった
  // データを pty:data として受け取る。
  initialBuffer: string;
  bufferingActive: boolean;
}

class PtyManager {
  private processes: Map<string, PtyProcess> = new Map();
  private windows: Map<number, BrowserWindow> = new Map();

  registerWindow(windowId: number, win: BrowserWindow): void {
    this.windows.set(windowId, win);
  }

  unregisterWindow(windowId: number): void {
    this.windows.delete(windowId);
  }

  private sendToRenderer(
    channel: string,
    data: unknown,
    windowId: number,
  ): void {
    const win = this.windows.get(windowId);
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }

  createPty(id: string, windowId: number, initialCwd?: string): boolean {
    if (this.processes.has(id)) {
      return false;
    }

    const shell = process.env.SHELL || "/bin/zsh";
    const homeDir = os.homedir();

    // initialCwdが指定されていてディレクトリが存在する場合はそれを使用
    const cwd = initialCwd && fs.existsSync(initialCwd) ? initialCwd : homeDir;

    try {
      // 環境変数フィルタ:
      //  - npm_*: nvm 互換のため除外（Electron パッケージ版 npm_config_prefix がシェルに漏れるのを防ぐ）
      //  - NODE_OPTIONS / LD_PRELOAD / DYLD_INSERT_LIBRARIES / DYLD_LIBRARY_PATH:
      //    Electron 側のロード設定や任意ライブラリ注入をシェル子プロセスに継承させない
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
      ) as { [key: string]: string };

      const integrationEnv = getShellIntegrationEnv(shell);
      const shellArgs = getShellArgs(shell);
      const shellName = path.basename(shell);

      const ptyProcess = pty.spawn(shell, shellArgs, {
        encoding: "utf8",
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd,
        env: {
          ...cleanEnv,
          ...integrationEnv,
          PATH: getMergedPath(),
          LANG: "ja_JP.UTF-8",
          LC_ALL: "ja_JP.UTF-8",
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
      });

      const proc: PtyProcess = {
        pty: ptyProcess,
        id,
        windowId,
        processNameInterval: null,
        shellName,
        initialBuffer: "",
        bufferingActive: true,
      };

      ptyProcess.onData((data) => {
        if (proc.bufferingActive) {
          // 上限超過時は累積分 + 今回分を一括 flush して通常モードへ。
          // renderer のリスナー登録より早すぎる送信になるリスクは残るが、
          // 64KB 出すような shell は明らかに異常なので buffering を維持しない。
          if (proc.initialBuffer.length + data.length > INITIAL_BUFFER_LIMIT) {
            proc.bufferingActive = false;
            const flushed = proc.initialBuffer + data;
            proc.initialBuffer = "";
            this.sendToRenderer("pty:data", { id, data: flushed }, windowId);
            return;
          }
          proc.initialBuffer += data;
          return;
        }
        this.sendToRenderer("pty:data", { id, data }, windowId);
      });

      ptyProcess.onExit(({ exitCode }) => {
        this.sendToRenderer("pty:exit", { id, exitCode }, windowId);
        if (proc.processNameInterval) {
          clearInterval(proc.processNameInterval);
        }
        this.processes.delete(id);
      });

      // シェル名をレンダラーに送信
      this.sendToRenderer("pty:shellName", { id, shellName }, windowId);

      // プロセス名ポーリング（1秒間隔で実行中プロセスを監視）
      let lastProcessName = shellName;
      proc.processNameInterval = setInterval(() => {
        try {
          const currentProcess = ptyProcess.process;
          if (currentProcess && currentProcess !== lastProcessName) {
            lastProcessName = currentProcess;
            this.sendToRenderer(
              "pty:processName",
              { id, processName: currentProcess },
              windowId,
            );
          }
        } catch {
          // プロセスが終了済みの場合は無視
        }
      }, 1000);

      this.processes.set(id, proc);
      return true;
    } catch (error) {
      console.error(`Failed to spawn PTY process for id ${id}:`, error);
      return false;
    }
  }

  write(id: string, data: string): void {
    const proc = this.processes.get(id);
    if (!proc) return;

    // 小さなデータはそのまま送信
    if (data.length <= LARGE_PASTE_THRESHOLD) {
      proc.pty.write(data);
      return;
    }

    // 大きなデータはチャンク分割して送信
    this.writeChunked(proc.pty, data).catch((error) => {
      console.error(`Failed to write chunked data to PTY ${id}:`, error);
    });
  }

  /**
   * 大きなデータをチャンク分割して送信
   * ブラケットペーストモードで囲むことでシェルが一括ペーストとして認識する
   */
  private async writeChunked(
    ptyInstance: pty.IPty,
    data: string,
  ): Promise<void> {
    // ブラケットペースト開始
    ptyInstance.write("\x1b[200~");

    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      ptyInstance.write(chunk);

      // 最後のチャンク以外は遅延を入れる
      if (i + CHUNK_SIZE < data.length) {
        await new Promise((r) => setTimeout(r, CHUNK_DELAY));
      }
    }

    // ブラケットペースト終了
    ptyInstance.write("\x1b[201~");
  }

  /**
   * spawn 直後にバッファに溜めた初期出力を一気に renderer へ送り、通常モードに移る。
   * renderer 側 `pty.create` の reply 直後（リスナー登録準備完了後）に呼ばれる前提。
   * 既に flush 済み・buffering オフの場合は何もしない（idempotent）。
   */
  flushInitialBuffer(id: string): void {
    const proc = this.processes.get(id);
    if (!proc || !proc.bufferingActive) return;
    proc.bufferingActive = false;
    if (proc.initialBuffer.length > 0) {
      const data = proc.initialBuffer;
      proc.initialBuffer = "";
      this.sendToRenderer("pty:data", { id, data }, proc.windowId);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const process = this.processes.get(id);
    if (process) {
      process.pty.resize(cols, rows);
    }
  }

  kill(id: string): void {
    const process = this.processes.get(id);
    if (process) {
      if (process.processNameInterval) {
        clearInterval(process.processNameInterval);
      }
      process.pty.kill();
      this.processes.delete(id);
    }
  }

  killAllForWindow(windowId: number): void {
    for (const [id, proc] of this.processes) {
      if (proc.windowId === windowId) {
        proc.pty.kill();
        this.processes.delete(id);
      }
    }
  }

  killAll(): void {
    for (const [id] of this.processes) {
      this.kill(id);
    }
    cleanupShellIntegration();
  }
}

export const ptyManager = new PtyManager();
