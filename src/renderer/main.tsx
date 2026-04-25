import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { restoreSession } from "./services/sessionRestore";

// React マウント前にセッション復元を試みる。
// terminalStore は module load 時に「初期 1 ペイン」を作るため、TerminalPane が
// PTY を生成する前にここでストアを差し替える必要がある。
// IPC は invoke ベースで取得し、解決後に React マウントすることでタイミング競合を回避。
async function bootstrap(): Promise<void> {
  try {
    const restoreData = await window.api.session.getRestoreData();
    if (restoreData) {
      restoreSession(restoreData);
    }
  } catch (e) {
    console.warn("[bootstrap] session restore failed:", e);
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
