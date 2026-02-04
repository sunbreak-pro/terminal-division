import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import * as os from 'os'

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
      const ptyProcess = pty.spawn(shell, [], {
        encoding: 'utf8',
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: homeDir,
        env: {
          ...process.env,
          LANG: 'ja_JP.UTF-8',
          LC_ALL: 'ja_JP.UTF-8',
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        } as { [key: string]: string }
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
    const process = this.processes.get(id)
    if (process) {
      process.pty.write(data)
    }
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
