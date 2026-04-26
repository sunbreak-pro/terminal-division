import { BrowserWindow, screen, shell, app } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { ptyManager } from "./pty-manager";
import { settingsManager } from "./settings";

const MAX_WINDOWS = 3;
const windows: Map<number, BrowserWindow> = new Map();

export function canCreateWindow(): boolean {
  return windows.size < MAX_WINDOWS;
}

export function getWindowCount(): number {
  return windows.size;
}

export function createWindow(initialCwd?: string): BrowserWindow | null {
  if (!canCreateWindow()) {
    return null;
  }

  // 画面中央に配置
  const { workAreaSize } = screen.getPrimaryDisplay();
  const width = 1200;
  const height = 800;
  const x = Math.round((workAreaSize.width - width) / 2);
  const y = Math.round((workAreaSize.height - height) / 2);

  // 設定からウィンドウ外観オプションを構築。vibrancyEnabled の場合は
  // transparent + vibrancy + 透明 backgroundColor の 3 点セットが必要（Electron 33）。
  const windowSettings = settingsManager.get().window;
  const vibrancyOptions = windowSettings.vibrancyEnabled
    ? {
        backgroundColor: "#00000000",
        transparent: true,
        vibrancy: "under-window" as const,
        visualEffectState: "active" as const,
      }
    : { backgroundColor: "#1a1a1a" };

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 600,
    minHeight: 400,
    show: false,
    ...vibrancyOptions,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 15, y: 10 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 起動時の不透明度を設定（vibrancy 有無に関わらず適用）
  win.setOpacity(windowSettings.opacity);

  const windowId = win.id;
  windows.set(windowId, win);
  ptyManager.registerWindow(windowId, win);

  win.on("ready-to-show", () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  win.on("closed", () => {
    ptyManager.killAllForWindow(windowId);
    ptyManager.unregisterWindow(windowId);
    windows.delete(windowId);

    // 全ウィンドウ閉じたらアプリ終了
    if (windows.size === 0) {
      app.quit();
    }
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Dockメニューからの起動時、初期CWDをレンダラーに送信
  if (initialCwd) {
    win.webContents.on("did-finish-load", () => {
      win.webContents.send("window:initialCwd", initialCwd);
    });
  }

  return win;
}
