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
        { type: "separator" },
        // フォントズームのキー登録は globalShortcut 側 (zoom-shortcuts.ts) に
        // 任せる。Chromium が Cmd+- 等をブラウザ層で消費する問題を回避するため。
        // メニューアイテムは「クリックでも実行できる UI」として残し、accelerator
        // ラベル表示はせずクリックハンドラだけ持たせる（accelerator を書くと
        // globalShortcut と二重登録になり挙動不安定）。
        {
          label: "フォント拡大",
          click: (_item, focusedWindow): void => {
            focusedWindow?.webContents.send("font-zoom:in");
          },
        },
        {
          label: "フォント縮小",
          click: (_item, focusedWindow): void => {
            focusedWindow?.webContents.send("font-zoom:out");
          },
        },
        {
          label: "フォントサイズをリセット",
          click: (_item, focusedWindow): void => {
            focusedWindow?.webContents.send("font-zoom:reset");
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
