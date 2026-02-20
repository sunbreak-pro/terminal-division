import { BrowserWindow, screen, shell, app } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { ptyManager } from './pty-manager'

const MAX_WINDOWS = 3
const windows: Map<number, BrowserWindow> = new Map()

export function canCreateWindow(): boolean {
  return windows.size < MAX_WINDOWS
}

export function getWindowCount(): number {
  return windows.size
}

export function getAllWindows(): Map<number, BrowserWindow> {
  return windows
}

export function createWindow(): BrowserWindow | null {
  if (!canCreateWindow()) {
    return null
  }

  // 画面中央に配置
  const { workAreaSize } = screen.getPrimaryDisplay()
  const width = 1200
  const height = 800
  const x = Math.round((workAreaSize.width - width) / 2)
  const y = Math.round((workAreaSize.height - height) / 2)

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 600,
    minHeight: 400,
    show: false,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  const windowId = win.id
  windows.set(windowId, win)
  ptyManager.registerWindow(windowId, win)

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  win.on('closed', () => {
    ptyManager.killAllForWindow(windowId)
    ptyManager.unregisterWindow(windowId)
    windows.delete(windowId)

    // 全ウィンドウ閉じたらアプリ終了
    if (windows.size === 0) {
      app.quit()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
