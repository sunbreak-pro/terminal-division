import { app, globalShortcut, BrowserWindow } from "electron";

// Cmd+= / Cmd+- / Cmd+0 のフォントズームショートカットを globalShortcut で登録する。
// 背景: Chromium が macOS の prePerformKeyEquivalent: でこれらのキーを
// アプリレベルアクセラレータとして消費するため、Electron メニュー accelerator も
// renderer keydown も届かないケースがある（Cmd+- 等）。globalShortcut は OS
// 直接のキー監視に乗せるため、Chromium の消費より前にコールバックが走る。
//
// グローバル動作の制限: フォーカス時のみ register、blur で unregister することで
// 他アプリ使用中の Cmd+- を奪わないようにする。
//
// IPC: 既存の "font-zoom:in" / "font-zoom:out" / "font-zoom:reset" を
// フォーカスされている BrowserWindow に送る。renderer 側 (App.tsx) で受信して
// adjustGlobalFontSize / resetGlobalFontSize を呼ぶ。

interface ZoomBinding {
  channel: "font-zoom:in" | "font-zoom:out" | "font-zoom:reset";
  accelerators: string[];
}

// 拡大は Cmd+; のみ。縮小は Cmd+- のみ。
const BINDINGS: ZoomBinding[] = [
  {
    channel: "font-zoom:in",
    accelerators: ["CommandOrControl+;"],
  },
  {
    channel: "font-zoom:out",
    accelerators: ["CommandOrControl+-"],
  },
  { channel: "font-zoom:reset", accelerators: ["CommandOrControl+0"] },
];

// Chromium のデフォルトズームショートカットを抑制するためのキー一覧。
// これらは Chromium が prePerformKeyEquivalent: で webFrame zoom を勝手に発火する。
// no-op の globalShortcut として登録することで、OS レベルで先取り消費させて
// Chromium まで届かないようにする。これがないと Cmd+_ / Cmd+= 等が裏で
// アプリ全体ズームを動かしてしまう（ユーザー要望: これらのキーを完全に無効化）。
const SUPPRESS_ACCELERATORS: string[] = [
  "CommandOrControl+=",
  "CommandOrControl+Plus",
  "CommandOrControl+Shift+=",
  "CommandOrControl+Shift+-",
];

const REGISTERED: string[] = [];

function dispatchToFocused(
  channel: ZoomBinding["channel"],
  accelerator: string,
): void {
  console.log("[zoom-shortcut]", channel, "via", accelerator);
  const win = BrowserWindow.getFocusedWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel);
}

function registerAll(): void {
  if (REGISTERED.length > 0) return; // 既に登録済み
  for (const { channel, accelerators } of BINDINGS) {
    for (const acc of accelerators) {
      try {
        const ok = globalShortcut.register(acc, () => {
          dispatchToFocused(channel, acc);
        });
        if (ok) {
          REGISTERED.push(acc);
        } else {
          console.warn("[zoom-shortcut] register failed:", acc);
        }
      } catch (e) {
        console.warn("[zoom-shortcut] register exception:", acc, e);
      }
    }
  }
  // Chromium デフォルトの抑制（no-op コールバック）
  for (const acc of SUPPRESS_ACCELERATORS) {
    try {
      const ok = globalShortcut.register(acc, () => {
        // 意図的に何もしない（Chromium デフォルトを食い止めるためだけに register する）
      });
      if (ok) REGISTERED.push(acc);
    } catch {
      // 抑制登録失敗は致命ではない
    }
  }
}

function unregisterAll(): void {
  for (const acc of REGISTERED) {
    try {
      globalShortcut.unregister(acc);
    } catch {
      // 既に解除済み等は無視
    }
  }
  REGISTERED.length = 0;
}

export function setupZoomShortcuts(): void {
  // フォーカス時に登録、blur で解除。これにより他アプリ使用中はキーを奪わない。
  app.on("browser-window-focus", () => {
    registerAll();
  });
  app.on("browser-window-blur", () => {
    // 別ウィンドウへの遷移時は次の focus イベントが発火するので一旦解除して問題ない
    unregisterAll();
  });
  // 起動時に既にウィンドウが focus している場合のため初回登録
  registerAll();
}

export function teardownZoomShortcuts(): void {
  unregisterAll();
}
