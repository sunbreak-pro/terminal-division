import { Menu, app } from "electron";
import { createWindow, canCreateWindow } from "./window-manager";

export function setupApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "ファイル",
      submenu: [
        {
          label: "新しいウィンドウ",
          accelerator: "CmdOrCtrl+N",
          click: (): void => {
            if (canCreateWindow()) {
              createWindow();
            }
          },
        },
        { type: "separator" },
        {
          label: "ウィンドウを閉じる",
          accelerator: "CmdOrCtrl+Shift+W",
          role: "close",
        },
      ],
    },
    {
      label: "編集",
      submenu: [{ role: "copy" }, { role: "paste" }, { role: "selectAll" }],
    },
    {
      label: "表示",
      submenu: [
        {
          label: "開発者ツール",
          accelerator: "CmdOrCtrl+Alt+I",
          click: (_item, focusedWindow): void => {
            focusedWindow?.webContents.toggleDevTools();
          },
        },
      ],
    },
    {
      label: "ウィンドウ",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
