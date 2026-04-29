import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { restoreSession } from "./services/sessionRestore";
import { initChatBridge } from "./services/chatBridge";

// React マウント前にセッション復元を試みる。
// terminalStore は module load 時に「初期 1 ペイン」を作るため、TerminalPane が
// PTY を生成する前にここでストアを差し替える必要がある。
// IPC は invoke ベースで取得し、解決後に React マウントすることでタイミング競合を回避。
async function bootstrap(): Promise<void> {
  try {
    // 設定の general.restoreSessionOnLaunch が false なら復元をスキップ。
    // settings の get と restore data の get は並列に実行して起動時間への影響を最小化する。
    const [settings, restoreData] = await Promise.all([
      window.api.settings.get(),
      window.api.session.getRestoreData(),
    ]);
    if (settings.general.restoreSessionOnLaunch && restoreData) {
      restoreSession(restoreData);
    }
  } catch (e) {
    console.warn("[bootstrap] session restore failed:", e);
  }

  // Chat バックエンドの IPC リスナーを 1 度だけ登録する（多重登録防止のためモジュール内 flag で制御）
  initChatBridge();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
