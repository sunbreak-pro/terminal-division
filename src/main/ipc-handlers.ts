import { ipcMain, BrowserWindow, app, dialog, shell } from 'electron'
import { ptyManager } from './pty-manager'

// IPCハンドラー登録（アプリ起動時に一度だけ呼ぶ）
export function setupIpcHandlers(): void {
  ipcMain.handle('pty:create', (_, id: string) => {
    return ptyManager.createPty(id)
  })

  ipcMain.on('pty:write', (_, { id, data }: { id: string; data: string }) => {
    ptyManager.write(id, data)
  })

  ipcMain.on('pty:resize', (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    ptyManager.resize(id, cols, rows)
  })

  ipcMain.on('pty:kill', (_, id: string) => {
    ptyManager.kill(id)
  })

  // ディレクトリ選択ダイアログ
  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'ディレクトリを選択',
      buttonLabel: '移動'
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  // 外部URLを開く
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return false
    }
    await shell.openExternal(url)
    return true
  })

  app.on('before-quit', () => {
    ptyManager.killAll()
  })
}

// メインウィンドウの設定（ウィンドウ作成のたびに呼ぶ）
export function setMainWindow(mainWindow: BrowserWindow): void {
  ptyManager.setMainWindow(mainWindow)

  mainWindow.on('closed', () => {
    ptyManager.killAll()
  })
}
