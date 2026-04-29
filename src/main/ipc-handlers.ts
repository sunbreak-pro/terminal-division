import { ipcMain, BrowserWindow, app, dialog, shell } from "electron";
import fs from "fs";
import { ptyManager } from "./pty-manager";
import { createWindow, canCreateWindow } from "./window-manager";
import { recentDirectoryManager } from "./recent-directories";
import { fileSystemManager } from "./file-system-handler";
import { sidebarStateManager } from "./sidebar-state";
import { sessionStateManager } from "./session-state";
import { settingsManager } from "./settings";
import { parseItermColors } from "./itermcolors-parser";
import { validatePath, PATH_REJECTED_ERROR } from "./path-validator";
import type { SerializedLayout } from "./types/session-state";
import type { PartialAppSettings } from "../shared/settings";

// IPCハンドラー登録（アプリ起動時に一度だけ呼ぶ）
export function setupIpcHandlers(): void {
  ipcMain.handle(
    "pty:create",
    (
      event,
      id: string,
      initialCwd?: string,
      options?: { shell?: string; defaultCwd?: string },
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return false;
      // initialCwd は任意。許可境界外なら無視して homedir フォールバックさせる
      const safeCwd = initialCwd ? validatePath(initialCwd) : null;
      // 設定で指定されたデフォルト CWD（initialCwd 未指定時のフォールバック）。
      // これも path-validator を通す。
      const safeDefault = options?.defaultCwd
        ? validatePath(options.defaultCwd)
        : null;
      return ptyManager.createPty(
        id,
        win.id,
        safeCwd ?? safeDefault ?? undefined,
        options?.shell,
      );
    },
  );

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

  // renderer 側で pty:data リスナーが登録準備完了したことを Main に通知し、
  // spawn 直後に溜めた初期出力を pty:data として吐き出す。
  ipcMain.on("pty:flushInitialBuffer", (_, id: string) => {
    ptyManager.flushInitialBuffer(id);
  });

  // 新しいウィンドウを作成
  ipcMain.handle("window:create", (_, initialCwd?: string) => {
    if (!canCreateWindow()) return false;
    const safeCwd = initialCwd ? validatePath(initialCwd) : null;
    const win = createWindow(safeCwd ?? undefined);
    return win !== null;
  });

  // 最近のディレクトリに追加
  ipcMain.on("recentDirs:add", (_, dirPath: string) => {
    const safe = validatePath(dirPath);
    if (!safe) return;
    recentDirectoryManager.addDirectory(safe);
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

  // 外部URLを開く（http / https のみ許可。file: / javascript: / data: 等を弾く）
  ipcMain.handle("shell:openExternal", async (_, url: string) => {
    if (typeof url !== "string" || url.length === 0) return false;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    await shell.openExternal(parsed.toString());
    return true;
  });

  // ========== File system (sidebar) ==========

  ipcMain.handle("fs:readDir", async (_, dirPath: string) => {
    const safe = validatePath(dirPath);
    if (!safe) return { ok: false as const, error: PATH_REJECTED_ERROR };
    try {
      return {
        ok: true as const,
        entries: await fileSystemManager.readDir(safe),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false as const, error: message };
    }
  });

  ipcMain.handle(
    "fs:searchTree",
    async (_, { rootPath, query }: { rootPath: string; query: string }) => {
      const safe = validatePath(rootPath);
      if (!safe) return { ok: false as const, error: PATH_REJECTED_ERROR };
      try {
        const { entries, truncated } = await fileSystemManager.searchTree(
          safe,
          query,
        );
        return { ok: true as const, entries, truncated };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.on("fs:watch", (event, dirPath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const safe = validatePath(dirPath);
    if (!safe) return;
    fileSystemManager.watch(safe, win.id);
  });

  ipcMain.on("fs:unwatch", (event, dirPath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const safe = validatePath(dirPath);
    if (!safe) return;
    fileSystemManager.unwatch(safe, win.id);
  });

  ipcMain.handle(
    "fs:rename",
    async (_, { oldPath, newName }: { oldPath: string; newName: string }) => {
      const safeOld = validatePath(oldPath);
      if (!safeOld) return { ok: false as const, error: PATH_REJECTED_ERROR };
      try {
        const newPath = await fileSystemManager.rename(safeOld, newName);
        // 出来上がりパスも境界内であること（ファイル名側に "../" は弾いているが防衛のため再検証）
        if (!validatePath(newPath)) {
          return { ok: false as const, error: PATH_REJECTED_ERROR };
        }
        return { ok: true as const, newPath };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle("fs:moveToDir", async (event, srcPath: string) => {
    const safeSrc = validatePath(srcPath);
    if (!safeSrc) return { ok: false as const, error: PATH_REJECTED_ERROR };
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
    // ダイアログ由来の destDir も念のため検証（OS の dialog は基本信頼できるが、symlink 等を弾く）
    const safeDest = validatePath(result.filePaths[0]);
    if (!safeDest) return { ok: false as const, error: PATH_REJECTED_ERROR };
    try {
      const newPath = await fileSystemManager.moveToDir(safeSrc, safeDest);
      return { ok: true as const, newPath };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false as const, error: message };
    }
  });

  ipcMain.handle("fs:trash", async (_, targetPath: string) => {
    const safe = validatePath(targetPath);
    if (!safe) return { ok: false as const, error: PATH_REJECTED_ERROR };
    try {
      await fileSystemManager.trash(safe);
      return { ok: true as const };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false as const, error: message };
    }
  });

  ipcMain.handle("fs:trashWithTracking", async (_, targetPath: string) => {
    const safe = validatePath(targetPath);
    if (!safe) return { ok: false as const, error: PATH_REJECTED_ERROR };
    try {
      const { trashedAt } = await fileSystemManager.trashWithTracking(safe);
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
      const safeTrashed = validatePath(trashedAt);
      const safeOriginal = validatePath(originalPath);
      if (!safeTrashed || !safeOriginal) {
        return { ok: false as const, error: PATH_REJECTED_ERROR };
      }
      try {
        await fileSystemManager.restoreFromTrash(safeTrashed, safeOriginal);
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
      const safeSrc = validatePath(srcPath);
      const safeDest = validatePath(destDir);
      if (!safeSrc || !safeDest) {
        return { ok: false as const, error: PATH_REJECTED_ERROR };
      }
      try {
        const newPath = await fileSystemManager.movePath(safeSrc, safeDest);
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
      const safeSrc = validatePath(srcPath);
      const safeDest = validatePath(destDir);
      if (!safeSrc || !safeDest) {
        return { ok: false as const, error: PATH_REJECTED_ERROR };
      }
      try {
        const newPath = await fileSystemManager.copyPath(safeSrc, safeDest);
        return { ok: true as const, newPath };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false as const, error: message };
      }
    },
  );

  // Markdown エディタ用: utf-8 テキストファイル読み書き。5MB 上限。
  // それ以外の用途を想定していないため、サイズ・エンコーディングは固定。
  ipcMain.handle("fs:readFile", async (_, filePath: string) => {
    const safe = validatePath(filePath);
    if (!safe) return { ok: false as const, error: PATH_REJECTED_ERROR };
    try {
      const result = await fileSystemManager.readTextFile(
        safe,
        5 * 1024 * 1024,
      );
      return { ok: true as const, content: result.content };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false as const, error: message };
    }
  });

  ipcMain.handle(
    "fs:writeFile",
    async (_, { filePath, content }: { filePath: string; content: string }) => {
      const safe = validatePath(filePath);
      if (!safe) return { ok: false as const, error: PATH_REJECTED_ERROR };
      if (typeof content !== "string") {
        return { ok: false as const, error: "内容が文字列ではありません" };
      }
      try {
        await fileSystemManager.writeTextFile(safe, content);
        return { ok: true as const };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle("fs:openInVSCode", async (_, targetPath: string) => {
    const safe = validatePath(targetPath);
    if (!safe) return { ok: false as const };
    const success = await fileSystemManager.openInVSCode(safe);
    return { ok: success };
  });

  // ========== Drag & Drop (OS-native start drag) ==========

  ipcMain.on("dnd:startDrag", async (event, filePath: string) => {
    const safe = validatePath(filePath);
    if (!safe) return;
    try {
      const icon = await app.getFileIcon(safe, { size: "normal" });
      event.sender.startDrag({ file: safe, icon });
    } catch (e) {
      console.warn("[dnd:startDrag]", e);
    }
  });

  // ========== Sidebar persisted state ==========

  ipcMain.handle("sidebar:getWidth", () => sidebarStateManager.getWidth());
  ipcMain.on("sidebar:setWidth", (_, width: number) => {
    sidebarStateManager.setWidth(width);
  });

  // ========== Session persistence ==========

  // 復元データは最初の 1 回だけ返す（multi-window はスコープ外）。
  // consume は sessionStateManager 側で同期的に行うため、setupIpcHandlers の
  // クロージャに状態を持たない。
  ipcMain.handle("session:getRestoreData", () => {
    return sessionStateManager.consumeRestoreData();
  });

  ipcMain.on("session:save", (_, payload: SerializedLayout) => {
    sessionStateManager.save(payload);
  });

  ipcMain.on("session:clear", () => {
    sessionStateManager.clear();
  });

  // ========== Settings ==========

  ipcMain.handle("settings:get", () => settingsManager.get());

  ipcMain.handle("settings:update", (_, patch: PartialAppSettings) => {
    return settingsManager.update(patch ?? {});
  });

  // .itermcolors ファイルを開いてテーマに変換。
  // base には現在のテーマ（AppColors を流用するため）を renderer から受け取る。
  ipcMain.handle(
    "settings:importItermColors",
    async (
      event,
      base: {
        id: string;
        name: string;
        colors: import("../shared/theme-types").AppColors;
        xterm: import("../shared/theme-types").XtermTheme;
      },
    ) => {
      const parentWin = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions = {
        properties: ["openFile" as const],
        filters: [{ name: "iTerm Colors", extensions: ["itermcolors"] }],
        title: "iTerm カラースキームを選択",
        buttonLabel: "インポート",
      };
      const result = parentWin
        ? await dialog.showOpenDialog(parentWin, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false as const, canceled: true };
      }
      const filePath = result.filePaths[0];
      try {
        // サイズチェック (1MB 上限) — 健全な .itermcolors は数 KB
        const stat = fs.statSync(filePath);
        if (stat.size > 1024 * 1024) {
          return {
            ok: false as const,
            error: "ファイルサイズが上限を超えています",
          };
        }
        const xml = fs.readFileSync(filePath, "utf-8");
        const fileName = filePath.split("/").pop() ?? "imported";
        const theme = parseItermColors(xml, fileName, base);
        if (!theme) {
          return {
            ok: false as const,
            error: "ファイルを解析できませんでした",
          };
        }
        return { ok: true as const, theme };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false as const, error: message };
      }
    },
  );

  // ウィンドウ不透明度を即時反映。再起動不要。
  ipcMain.on("window:setOpacity", (event, value: number) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    const clamped = Math.max(0.5, Math.min(1.0, value));
    win.setOpacity(clamped);
  });

  // アプリ再起動（vibrancy 切替時に renderer から要求される）
  ipcMain.on("app:relaunch", () => {
    app.relaunch();
    app.exit(0);
  });

  app.on("before-quit", () => {
    ptyManager.killAll();
    fileSystemManager.closeAll();
  });
}
