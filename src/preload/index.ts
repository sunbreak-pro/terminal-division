import { contextBridge, ipcRenderer, webUtils } from "electron";

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
  },
  recentDirs: {
    add: (dirPath: string): void => ipcRenderer.send("recentDirs:add", dirPath),
  },
  theme: {
    notifyChanged: (themeId: string): void =>
      ipcRenderer.send("theme:changed", themeId),
    onSync: createIpcListener<string>("theme:sync"),
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
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
