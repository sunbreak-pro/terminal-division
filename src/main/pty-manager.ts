import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import * as os from 'os'

// チャンク分割送信用の定数
const CHUNK_SIZE = 1024 // 1KB単位で分割
const CHUNK_DELAY = 10 // チャンク間10ms遅延
const LARGE_PASTE_THRESHOLD = 512 // この閾値以上でチャンク処理

interface PtyProcess {
  pty: pty.IPty
  id: string
}

class PtyManager {
  private processes: Map<string, PtyProcess> = new Map()
  private mainWindow: BrowserWindow | null = null

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  private sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
  }

  createPty(id: string): boolean {
    if (this.processes.has(id)) {
      return false
    }

    const shell = process.env.SHELL || '/bin/zsh'
    const homeDir = os.homedir()

    try {
      // npm関連の環境変数を除外（nvm互換性のため）
      // Electronパッケージ版ビルド時のnpm_config_prefixなどがシェルに渡されるのを防ぐ
      const cleanEnv = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith('npm_'))
      ) as { [key: string]: string }

      const ptyProcess = pty.spawn(shell, [], {
        encoding: 'utf8',
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: homeDir,
        env: {
          ...cleanEnv,
          LANG: 'ja_JP.UTF-8',
          LC_ALL: 'ja_JP.UTF-8',
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        }
      })

      ptyProcess.onData((data) => {
        this.sendToRenderer('pty:data', { id, data })
      })

      ptyProcess.onExit(({ exitCode }) => {
        this.sendToRenderer('pty:exit', { id, exitCode })
        this.processes.delete(id)
      })

      this.processes.set(id, { pty: ptyProcess, id })
      return true
    } catch (error) {
      console.error(`Failed to spawn PTY process for id ${id}:`, error)
      return false
    }
  }

  write(id: string, data: string): void {
    const proc = this.processes.get(id)
    if (!proc) return

    // 小さなデータはそのまま送信
    if (data.length <= LARGE_PASTE_THRESHOLD) {
      proc.pty.write(data)
      return
    }

    // 大きなデータはチャンク分割して送信
    this.writeChunked(proc.pty, data)
  }

  /**
   * 大きなデータをチャンク分割して送信
   * ブラケットペーストモードで囲むことでシェルが一括ペーストとして認識する
   */
  private async writeChunked(ptyInstance: pty.IPty, data: string): Promise<void> {
    // ブラケットペースト開始
    ptyInstance.write('\x1b[200~')

    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE)
      ptyInstance.write(chunk)

      // 最後のチャンク以外は遅延を入れる
      if (i + CHUNK_SIZE < data.length) {
        await new Promise((r) => setTimeout(r, CHUNK_DELAY))
      }
    }

    // ブラケットペースト終了
    ptyInstance.write('\x1b[201~')
  }

  resize(id: string, cols: number, rows: number): void {
    const process = this.processes.get(id)
    if (process) {
      process.pty.resize(cols, rows)
    }
  }

  kill(id: string): void {
    const process = this.processes.get(id)
    if (process) {
      process.pty.kill()
      this.processes.delete(id)
    }
  }

  killAll(): void {
    for (const [id] of this.processes) {
      this.kill(id)
    }
  }
}

export const ptyManager = new PtyManager()
