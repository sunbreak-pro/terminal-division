import { Menu, app } from "electron";
import os from "os";
import { createWindow, canCreateWindow } from "./window-manager";
import { recentDirectoryManager } from "./recent-directories";

const homeDir = os.homedir();

function shortenPath(dirPath: string): string {
  if (dirPath.startsWith(homeDir)) {
    return "~" + dirPath.slice(homeDir.length);
  }
  return dirPath;
}

function buildDockMenu(): void {
  const recentDirs = recentDirectoryManager.getDirectories();

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "新しいウィンドウ",
      click: (): void => {
        if (canCreateWindow()) {
          createWindow();
        }
      },
    },
  ];

  if (recentDirs.length > 0) {
    template.push({ type: "separator" });
    template.push({ label: "最近のディレクトリ", enabled: false });

    for (const dir of recentDirs) {
      template.push({
        label: shortenPath(dir.path),
        click: (): void => {
          if (canCreateWindow()) {
            createWindow(dir.path);
          }
        },
      });
    }
  }

  const dockMenu = Menu.buildFromTemplate(template);
  app.dock?.setMenu(dockMenu);
}

export function setupDockMenu(): void {
  buildDockMenu();
  // 最近のディレクトリ変更時にメニューを再構築
  recentDirectoryManager.onChange(() => {
    buildDockMenu();
  });
}
