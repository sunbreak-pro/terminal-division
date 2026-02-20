import { contextBridge, ipcRenderer } from "electron";

export type PtyDataCallback = (data: { id: string; data: string }) => void;
export type PtyExitCallback = (data: { id: string; exitCode: number }) => void;

function createIpcListener<T>(channel: string) {
  return (callback: (data: T) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: T): void =>
      callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

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
    create: (): Promise<boolean> => ipcRenderer.invoke("window:create"),
  },
  theme: {
    notifyChanged: (themeId: string): void =>
      ipcRenderer.send("theme:changed", themeId),
    onSync: createIpcListener<string>("theme:sync"),
  },
  dialog: {
    selectDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:selectDirectory"),
  },
  shell: {
    openExternal: (url: string): Promise<boolean> =>
      ipcRenderer.invoke("shell:openExternal", url),
  },
  system: {
    getHomeDir: (): string => process.env.HOME || "",
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
