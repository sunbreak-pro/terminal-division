import { ipcMain, BrowserWindow, app, dialog, shell } from "electron";
import { ptyManager } from "./pty-manager";
import { createWindow, canCreateWindow } from "./window-manager";
import { recentDirectoryManager } from "./recent-directories";
import { fileSystemManager } from "./file-system-handler";
import { sidebarStateManager } from "./sidebar-state";

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
  ipcMain.handle("window:create", (_, initialCwd?: string) => {
    if (!canCreateWindow()) return false;
    const win = createWindow(initialCwd);
    return win !== null;
  });

  // 最近のディレクトリに追加
  ipcMain.on("recentDirs:add", (_, dirPath: string) => {
    recentDirectoryManager.addDirectory(dirPath);
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

  // ファイル選択ダイアログ（複数選択可、ターミナルへパス挿入用）
  ipcMain.handle("dialog:selectFiles", async (event) => {
    const parentWin = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      properties: [
        "openFile" as const,
        "multiSelections" as const,
        "treatPackageAsDirectory" as const,
      ],
      title: "ファイルを選択",
      buttonLabel: "挿入",
    };
    const result = parentWin
      ? await dialog.showOpenDialog(parentWin, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths;
  });

  // 外部URLを開く
  ipcMain.handle("shell:openExternal", async (_, url: string) => {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return false;
    }
    await shell.openExternal(url);
    return true;
  });

  // ========== File system (sidebar) ==========

  ipcMain.handle("fs:readDir", async (_, dirPath: string) => {
    try {
      return {
        ok: true as const,
        entries: await fileSystemManager.readDir(dirPath),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false as const, error: message };
    }
  });

  ipcMain.on("fs:watch", (event, dirPath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    fileSystemManager.watch(dirPath, win.id);
  });

  ipcMain.on("fs:unwatch", (event, dirPath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    fileSystemManager.unwatch(dirPath, win.id);
  });

  ipcMain.handle(
    "fs:rename",
    async (_, { oldPath, newName }: { oldPath: string; newName: string }) => {
      try {
        return {
          ok: true as const,
          newPath: await fileSystemManager.rename(oldPath, newName),
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle("fs:moveToDir", async (event, srcPath: string) => {
    const parentWin = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      properties: ["openDirectory" as const],
      title: "移動先のディレクトリを選択",
      buttonLabel: "ここに移動",
    };
    const result = parentWin
      ? await dialog.showOpenDialog(parentWin, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false as const, canceled: true };
    }
    try {
      const newPath = await fileSystemManager.moveToDir(
        srcPath,
        result.filePaths[0],
      );
      return { ok: true as const, newPath };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false as const, error: message };
    }
  });

  ipcMain.handle("fs:trash", async (_, targetPath: string) => {
    try {
      await fileSystemManager.trash(targetPath);
      return { ok: true as const };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false as const, error: message };
    }
  });

  ipcMain.handle("fs:trashWithTracking", async (_, targetPath: string) => {
    try {
      const { trashedAt } =
        await fileSystemManager.trashWithTracking(targetPath);
      return { ok: true as const, trashedAt };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false as const, error: message };
    }
  });

  ipcMain.handle(
    "fs:restoreFromTrash",
    async (
      _,
      { trashedAt, originalPath }: { trashedAt: string; originalPath: string },
    ) => {
      try {
        await fileSystemManager.restoreFromTrash(trashedAt, originalPath);
        return { ok: true as const };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle(
    "fs:movePath",
    async (_, { srcPath, destDir }: { srcPath: string; destDir: string }) => {
      try {
        const newPath = await fileSystemManager.movePath(srcPath, destDir);
        return { ok: true as const, newPath };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle(
    "fs:copyPath",
    async (_, { srcPath, destDir }: { srcPath: string; destDir: string }) => {
      try {
        const newPath = await fileSystemManager.copyPath(srcPath, destDir);
        return { ok: true as const, newPath };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle("fs:openInVSCode", async (_, targetPath: string) => {
    const success = await fileSystemManager.openInVSCode(targetPath);
    return { ok: success };
  });

  // ========== Drag & Drop (OS-native start drag) ==========

  ipcMain.on("dnd:startDrag", async (event, filePath: string) => {
    try {
      const icon = await app.getFileIcon(filePath, { size: "normal" });
      event.sender.startDrag({ file: filePath, icon });
    } catch (e) {
      console.warn("[dnd:startDrag]", e);
    }
  });

  // ========== Sidebar persisted state ==========

  ipcMain.handle("sidebar:getWidth", () => sidebarStateManager.getWidth());
  ipcMain.on("sidebar:setWidth", (_, width: number) => {
    sidebarStateManager.setWidth(width);
  });

  app.on("before-quit", () => {
    ptyManager.killAll();
    fileSystemManager.closeAll();
  });
}
