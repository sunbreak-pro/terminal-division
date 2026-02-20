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

interface PtyProcess {
  pty: pty.IPty;
  id: string;
  windowId: number;
  processNameInterval: ReturnType<typeof setInterval> | null;
  shellName: string;
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

  broadcastToAll(
    channel: string,
    data: unknown,
    excludeWindowId?: number,
  ): void {
    for (const [id, win] of this.windows) {
      if (id !== excludeWindowId && !win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
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
      // npm関連の環境変数を除外（nvm互換性のため）
      // Electronパッケージ版ビルド時のnpm_config_prefixなどがシェルに渡されるのを防ぐ
      const cleanEnv = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("npm_")),
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

      ptyProcess.onData((data) => {
        this.sendToRenderer("pty:data", { id, data }, windowId);
      });

      ptyProcess.onExit(({ exitCode }) => {
        this.sendToRenderer("pty:exit", { id, exitCode }, windowId);
        const proc = this.processes.get(id);
        if (proc?.processNameInterval) {
          clearInterval(proc.processNameInterval);
        }
        this.processes.delete(id);
      });

      // シェル名をレンダラーに送信
      this.sendToRenderer("pty:shellName", { id, shellName }, windowId);

      // プロセス名ポーリング（1秒間隔で実行中プロセスを監視）
      let lastProcessName = shellName;
      const processNameInterval = setInterval(() => {
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

      this.processes.set(id, {
        pty: ptyProcess,
        id,
        windowId,
        processNameInterval,
        shellName,
      });
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
    this.writeChunked(proc.pty, data);
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
