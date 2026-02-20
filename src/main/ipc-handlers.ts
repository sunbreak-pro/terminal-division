import { ipcMain, BrowserWindow, app, dialog, shell } from "electron";
import { ptyManager } from "./pty-manager";
import { createWindow, canCreateWindow } from "./window-manager";

// IPCハンドラー登録（アプリ起動時に一度だけ呼ぶ）
export function setupIpcHandlers(): void {
  ipcMain.handle("pty:create", (event, id: string, initialCwd?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    return ptyManager.createPty(id, win.id, initialCwd);
  });

  ipcMain.on("pty:write", (_, { id, data }: { id: string; data: string }) => {
    ptyManager.write(id, data);
  });

  ipcMain.on(
    "pty:resize",
    (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
      ptyManager.resize(id, cols, rows);
    },
  );

  ipcMain.on("pty:kill", (_, id: string) => {
    ptyManager.kill(id);
  });

  // 新しいウィンドウを作成
  ipcMain.handle("window:create", () => {
    if (!canCreateWindow()) return false;
    const win = createWindow();
    return win !== null;
  });

  // テーマ変更を他のウィンドウに同期
  ipcMain.on("theme:changed", (event, themeId: string) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const excludeId = senderWin ? senderWin.id : undefined;
    ptyManager.broadcastToAll("theme:sync", themeId, excludeId);
  });

  // ディレクトリ選択ダイアログ
  ipcMain.handle("dialog:selectDirectory", async (event) => {
    const parentWin = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      properties: ["openDirectory" as const],
      title: "ディレクトリを選択",
      buttonLabel: "移動",
    };
    const result = parentWin
      ? await dialog.showOpenDialog(parentWin, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // 外部URLを開く
  ipcMain.handle("shell:openExternal", async (_, url: string) => {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return false;
    }
    await shell.openExternal(url);
    return true;
  });

  app.on("before-quit", () => {
    ptyManager.killAll();
  });
}
