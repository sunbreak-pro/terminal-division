import { app } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { setupIpcHandlers } from "./ipc-handlers";
import { createWindow, getWindowCount } from "./window-manager";
import { setupApplicationMenu } from "./menu";
import { setupDockMenu } from "./dock-menu";
import {
  cleanup as cleanupShellIntegration,
  resolveLoginShellPath,
} from "./shell-integration";

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.terminal-division");

  // ログインシェルからPATHを解決（PTY起動前に実行）
  resolveLoginShellPath();

  setupIpcHandlers();
  setupApplicationMenu();
  setupDockMenu();

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on("activate", function () {
    if (getWindowCount() === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

process.on("exit", () => {
  cleanupShellIntegration();
});
