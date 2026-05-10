import { contextBridge, ipcRenderer, webUtils, webFrame } from "electron";

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
    create: (
      id: string,
      initialCwd?: string,
      options?: { shell?: string; defaultCwd?: string },
    ): Promise<boolean> =>
      ipcRenderer.invoke("pty:create", id, initialCwd, options),
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
    // アプリ全体（このウィンドウの WebFrame）のズーム倍率を即時反映。
    // settings.general.appZoomFactor の更新フックから呼ばれる。
    // contextIsolation が有効でも webFrame は preload から呼べるため IPC 経由ではなく直接呼ぶ。
    setZoomFactor: (value: number): void => {
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      try {
        webFrame.setZoomFactor(value);
      } catch {
        // 範囲外などは黙って無視（renderer 側で clamp 済みのため通常は起きない）
      }
    },
    // フルスクリーンとウィンドウサイズ表示の切替（ショートカットから叩く）
    toggleFullScreen: (): void => ipcRenderer.send("window:toggleFullScreen"),
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
  pinnedDirs: {
    get: (): Promise<string[]> => ipcRenderer.invoke("pinnedDirs:get"),
    add: (dirPath: string): Promise<boolean> =>
      ipcRenderer.invoke("pinnedDirs:add", dirPath),
    remove: (dirPath: string): Promise<boolean> =>
      ipcRenderer.invoke("pinnedDirs:remove", dirPath),
  },
  git: {
    resolveRoot: (cwd: string): Promise<string | null> =>
      ipcRenderer.invoke("git:resolveRoot", cwd),
    status: (
      cwd: string,
    ): Promise<
      | {
          ok: true;
          status: {
            root: string;
            current: string | null;
            tracking: string | null;
            ahead: number;
            behind: number;
            files: {
              path: string;
              index: string;
              workingDir: string;
              staged: boolean;
              modified: boolean;
              untracked: boolean;
              conflict: boolean;
            }[];
            isClean: boolean;
          };
        }
      | { ok: false; error: string }
    > => ipcRenderer.invoke("git:status", cwd),
    branchList: (
      cwd: string,
    ): Promise<
      | {
          ok: true;
          branches: {
            name: string;
            current: boolean;
            remote: boolean;
            commit: string;
          }[];
        }
      | { ok: false; error: string }
    > => ipcRenderer.invoke("git:branchList", cwd),
    branchCreate: (
      cwd: string,
      name: string,
      from?: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("git:branchCreate", cwd, name, from),
    branchDelete: (
      cwd: string,
      name: string,
      force?: boolean,
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("git:branchDelete", cwd, name, force),
    branchSwitch: (
      cwd: string,
      name: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("git:branchSwitch", cwd, name),
    stage: (
      cwd: string,
      paths: string[],
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("git:stage", cwd, paths),
    unstage: (
      cwd: string,
      paths: string[],
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("git:unstage", cwd, paths),
    commit: (
      cwd: string,
      message: string,
    ): Promise<{ ok: true; commit: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke("git:commit", cwd, message),
    push: (
      cwd: string,
      remote?: string,
      branch?: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("git:push", cwd, remote, branch),
    pull: (
      cwd: string,
      remote?: string,
      branch?: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("git:pull", cwd, remote, branch),
    fetch: (
      cwd: string,
      remote?: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("git:fetch", cwd, remote),
    diff: (
      cwd: string,
      path?: string,
      staged?: boolean,
    ): Promise<{ ok: true; diff: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke("git:diff", cwd, path, staged),
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
    openPath: (
      targetPath: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("shell:openPath", targetPath),
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
    // ルート配下を再帰検索してファイル名がクエリを含むものを最大 500 件返す
    searchTree: (
      rootPath: string,
      query: string,
    ): Promise<
      | {
          ok: true;
          entries: {
            name: string;
            path: string;
            isDirectory: boolean;
            isSymlink: boolean;
          }[];
          truncated: boolean;
        }
      | { ok: false; error: string }
    > => ipcRenderer.invoke("fs:searchTree", { rootPath, query }),
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
  rightSidebar: {
    getWidth: (): Promise<number> =>
      ipcRenderer.invoke("rightSidebar:getWidth"),
    setWidth: (width: number): void =>
      ipcRenderer.send("rightSidebar:setWidth", width),
    getOpen: (): Promise<boolean> => ipcRenderer.invoke("rightSidebar:getOpen"),
    setOpen: (open: boolean): void =>
      ipcRenderer.send("rightSidebar:setOpen", open),
    getFullscreen: (): Promise<boolean> =>
      ipcRenderer.invoke("rightSidebar:getFullscreen"),
    setFullscreen: (fullscreen: boolean): void =>
      ipcRenderer.send("rightSidebar:setFullscreen", fullscreen),
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
  // 表示メニュー / globalShortcut からのアプリ全体ズーム IPC。
  // Chromium が Cmd+; / Cmd+- / Cmd+0 をブラウザ層で消費するため、
  // メニューアクセラレータ or globalShortcut 経由で受け取って renderer 側で処理する。
  menu: {
    onAppZoomIn: createIpcListener<void>("app-zoom:in"),
    onAppZoomOut: createIpcListener<void>("app-zoom:out"),
    onAppZoomReset: createIpcListener<void>("app-zoom:reset"),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
