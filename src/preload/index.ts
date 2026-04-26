import { contextBridge, ipcRenderer, webUtils } from "electron";

// セッション永続化 IPC 用の DTO 型は shared モジュールに集約
import type { SerializedLayout } from "../shared/session-state-validator";
import type { AppSettings, PartialAppSettings } from "../shared/settings";
import type { Theme, AppColors, XtermTheme } from "../shared/theme-types";

function createIpcListener<T>(channel: string) {
  return (callback: (data: T) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: T): void =>
      callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

// Dockメニューからの初期CWDをバッファ（Reactマウント前に受信する可能性があるため）
let initialCwdBuffer: string | null = null;
ipcRenderer.on("window:initialCwd", (_, cwd: string) => {
  initialCwdBuffer = cwd;
});

const api = {
  pty: {
    create: (id: string, initialCwd?: string): Promise<boolean> =>
      ipcRenderer.invoke("pty:create", id, initialCwd),
    write: (id: string, data: string): void =>
      ipcRenderer.send("pty:write", { id, data }),
    resize: (id: string, cols: number, rows: number): void =>
      ipcRenderer.send("pty:resize", { id, cols, rows }),
    kill: (id: string): void => ipcRenderer.send("pty:kill", id),
    // pty:create の reply を受けた後に呼ぶ。Main 側で spawn 直後に溜めた初期出力を pty:data として受け取る。
    flushInitialBuffer: (id: string): void =>
      ipcRenderer.send("pty:flushInitialBuffer", id),
    onData: createIpcListener<{ id: string; data: string }>("pty:data"),
    onExit: createIpcListener<{ id: string; exitCode: number }>("pty:exit"),
    onProcessName: createIpcListener<{ id: string; processName: string }>(
      "pty:processName",
    ),
    onShellName: createIpcListener<{ id: string; shellName: string }>(
      "pty:shellName",
    ),
  },
  window: {
    create: (initialCwd?: string): Promise<boolean> =>
      ipcRenderer.invoke("window:create", initialCwd),
    getInitialCwd: (): string | null => {
      const cwd = initialCwdBuffer;
      initialCwdBuffer = null; // 一度消費したらクリア
      return cwd;
    },
    // 不透明度を即時反映（再起動不要）
    setOpacity: (value: number): void =>
      ipcRenderer.send("window:setOpacity", value),
  },
  app: {
    // vibrancy 切替後の再起動。renderer 側で確認モーダルを出してから呼ぶ。
    relaunch: (): void => ipcRenderer.send("app:relaunch"),
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
    update: (patch: PartialAppSettings): Promise<AppSettings> =>
      ipcRenderer.invoke("settings:update", patch),
    importItermColors: (base: {
      id: string;
      name: string;
      colors: AppColors;
      xterm: XtermTheme;
    }): Promise<
      | { ok: true; theme: Theme }
      | { ok: false; canceled?: boolean; error?: string }
    > => ipcRenderer.invoke("settings:importItermColors", base),
    onChanged: createIpcListener<AppSettings>("settings:changed"),
  },
  recentDirs: {
    add: (dirPath: string): void => ipcRenderer.send("recentDirs:add", dirPath),
  },
  dialog: {
    selectDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:selectDirectory"),
    selectFiles: (): Promise<string[] | null> =>
      ipcRenderer.invoke("dialog:selectFiles"),
  },
  shell: {
    openExternal: (url: string): Promise<boolean> =>
      ipcRenderer.invoke("shell:openExternal", url),
  },
  system: {
    getHomeDir: (): string => process.env.HOME || "",
  },
  fs: {
    readDir: (
      dirPath: string,
    ): Promise<
      | {
          ok: true;
          entries: {
            name: string;
            path: string;
            isDirectory: boolean;
            isSymlink: boolean;
          }[];
        }
      | { ok: false; error: string }
    > => ipcRenderer.invoke("fs:readDir", dirPath),
    watch: (dirPath: string): void => ipcRenderer.send("fs:watch", dirPath),
    unwatch: (dirPath: string): void => ipcRenderer.send("fs:unwatch", dirPath),
    onChange: createIpcListener<{
      watchedPath: string;
      type: "add" | "addDir" | "unlink" | "unlinkDir" | "change";
      changedPath: string;
    }>("fs:change"),
    // chokidar の error 連発を閾値判定して 1 度だけ通知する
    onWatcherError: createIpcListener<{ dirPath: string; message: string }>(
      "fs:watcherError",
    ),
    rename: (
      oldPath: string,
      newName: string,
    ): Promise<{ ok: true; newPath: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke("fs:rename", { oldPath, newName }),
    moveToDir: (
      srcPath: string,
    ): Promise<
      | { ok: true; newPath: string }
      | { ok: false; canceled?: boolean; error?: string }
    > => ipcRenderer.invoke("fs:moveToDir", srcPath),
    trash: (
      targetPath: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("fs:trash", targetPath),
    trashWithTracking: (
      targetPath: string,
    ): Promise<
      { ok: true; trashedAt: string | null } | { ok: false; error: string }
    > => ipcRenderer.invoke("fs:trashWithTracking", targetPath),
    restoreFromTrash: (
      trashedAt: string,
      originalPath: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("fs:restoreFromTrash", { trashedAt, originalPath }),
    movePath: (
      srcPath: string,
      destDir: string,
    ): Promise<{ ok: true; newPath: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke("fs:movePath", { srcPath, destDir }),
    copyPath: (
      srcPath: string,
      destDir: string,
    ): Promise<{ ok: true; newPath: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke("fs:copyPath", { srcPath, destDir }),
    openInVSCode: (targetPath: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("fs:openInVSCode", targetPath),
    readFile: (
      filePath: string,
    ): Promise<{ ok: true; content: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke("fs:readFile", filePath),
    writeFile: (
      filePath: string,
      content: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("fs:writeFile", { filePath, content }),
    // OS-native drag が drop された際、File から絶対パスを取り出す
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  },
  dnd: {
    startDrag: (filePath: string): void =>
      ipcRenderer.send("dnd:startDrag", filePath),
  },
  sidebar: {
    getWidth: (): Promise<number> => ipcRenderer.invoke("sidebar:getWidth"),
    setWidth: (width: number): void =>
      ipcRenderer.send("sidebar:setWidth", width),
  },
  session: {
    save: (payload: SerializedLayout): void =>
      ipcRenderer.send("session:save", payload),
    clear: (): void => ipcRenderer.send("session:clear"),
    // 起動時の復元データを 1 回だけ取り出す（Main 側で重複返却を抑制）
    getRestoreData: (): Promise<SerializedLayout | null> =>
      ipcRenderer.invoke("session:getRestoreData"),
    // session-state.json 書き込み失敗を renderer に通知（toast 表示）
    onSaveFailed: createIpcListener<{ message: string }>("session:saveFailed"),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
