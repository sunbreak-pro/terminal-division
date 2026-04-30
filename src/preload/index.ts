import { contextBridge, ipcRenderer, webUtils, webFrame } from "electron";

// セッション永続化 IPC 用の DTO 型は shared モジュールに集約
import type { SerializedLayout } from "../shared/session-state-validator";
import type { AppSettings, PartialAppSettings } from "../shared/settings";
import type { Theme, AppColors, XtermTheme } from "../shared/theme-types";
import type { ChatEventEnvelope } from "../shared/chat-events";

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
  // ===== Chat (Claude Code chat backend) =====
  // 子プロセス `claude -p --input-format stream-json --output-format stream-json` を
  // ペイン単位で 1 つ保持し、stdin/stdout 経由で双方向通信する。
  // viewMode=chat への遷移時に start() を呼び、CLI に戻るときは sessionId を控えて
  // PTY 側で `claude --resume <id>` を起動できるようにする（Renderer 側 chatBridge が責務）。
  chat: {
    start: (
      paneId: string,
      cwd: string,
      options?: { resumeSessionId?: string },
    ): Promise<
      { ok: true; sessionId?: string } | { ok: false; error?: string }
    > => ipcRenderer.invoke("chat:start", paneId, cwd, options),
    send: (paneId: string, content: string): void =>
      ipcRenderer.send("chat:send", { paneId, content }),
    stop: (paneId: string): void => ipcRenderer.send("chat:stop", paneId),
    dispose: (paneId: string): void => ipcRenderer.send("chat:dispose", paneId),
    getSessionId: (paneId: string): Promise<string | null> =>
      ipcRenderer.invoke("chat:getSessionId", paneId),
    onEvent: createIpcListener<{
      paneId: string;
      event: ChatEventEnvelope;
    }>("chat:event"),
    onClaudeDetected: createIpcListener<{ paneId: string }>(
      "chat:claudeDetected",
    ),
    // Chat 起動前の信頼確認用。$HOME か未信頼 CWD なら Renderer 側でモーダルを出す。
    checkTrust: (
      cwd: string,
    ): Promise<{ cwd: string; isHome: boolean; trusted: boolean }> =>
      ipcRenderer.invoke("chat:checkTrust", cwd),
    trust: (cwd: string): void => ipcRenderer.send("chat:trust", cwd),
    // / 入力時のスラッシュ候補（builtin command + skills）
    listSlashItems: (
      cwd: string,
    ): Promise<
      Array<{
        insert: string;
        label: string;
        description: string;
        scope: "global" | "project" | "builtin";
        kind: "command" | "skill";
      }>
    > => ipcRenderer.invoke("chat:listSlashItems", cwd),
  },
  // 表示メニューからのフォントズーム IPC。
  // Chromium が Cmd+= / Cmd+- / Cmd+0 をブラウザ層で消費するため、
  // メニューアクセラレータ経由で受け取って renderer 側で処理する。
  menu: {
    onFontZoomIn: createIpcListener<void>("font-zoom:in"),
    onFontZoomOut: createIpcListener<void>("font-zoom:out"),
    onFontZoomReset: createIpcListener<void>("font-zoom:reset"),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
