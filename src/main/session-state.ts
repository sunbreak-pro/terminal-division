import { app, BrowserWindow } from "electron";
import { join } from "path";
import fs from "fs";
import {
  validateSerializedLayout,
  type SerializedLayout,
} from "../shared/session-state-validator";

// 後方互換: 既存の import からは引き続き本ファイルから取り出せるようにする
export { validateSerializedLayout } from "../shared/session-state-validator";

const SAVE_DEBOUNCE_MS = 250;

class SessionStateManager {
  private filePath: string;
  private state: SerializedLayout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  // 起動時の復元データを最初の 1 回だけ返す。multi-window 起動時に
  // 2 つ目以降のウィンドウへ復元データを渡してしまわないためのガード。
  private restoreConsumed = false;

  constructor() {
    this.filePath = join(app.getPath("userData"), "session-state.json");
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.state = null;
        return;
      }
      const raw: unknown = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      const validated = validateSerializedLayout(raw);
      this.state = validated;
    } catch {
      // 破損 / 検証失敗 → サイレントフォールバック
      this.state = null;
    }
  }

  private writeNow(): void {
    try {
      if (this.state === null) {
        if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
        return;
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.warn("[SessionState] save error:", e);
      this.notifySaveFailed(e instanceof Error ? e.message : String(e));
    }
  }

  // 全 BrowserWindow に session save 失敗を通知（renderer で toast 表示）。
  // 連投制御は renderer 側で 30 秒 dedup する想定。
  private notifySaveFailed(message: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("session:saveFailed", { message });
      }
    }
  }

  // 起動時に 1 度だけ呼ばれ、復元データを返す。検証失敗時は null。
  // テストや診断目的で消費フラグを立てずに参照できる read-only API。
  getRestoreData(): SerializedLayout | null {
    return this.state;
  }

  // 復元データを「最初の 1 回だけ」取り出す。同期的に consumed フラグを
  // 立てるため、複数ウィンドウ起動時の race を構造的に防げる。
  consumeRestoreData(): SerializedLayout | null {
    if (this.restoreConsumed) return null;
    this.restoreConsumed = true;
    return this.state;
  }

  save(layout: SerializedLayout): void {
    const validated = validateSerializedLayout(layout);
    if (!validated) {
      // Main 側でも防衛的に検証。失敗したら無視（古い状態を維持）。
      console.warn("[SessionState] save rejected: validation failed");
      return;
    }
    this.state = validated;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.writeNow(), SAVE_DEBOUNCE_MS);
  }

  clear(): void {
    this.state = null;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.writeNow(), SAVE_DEBOUNCE_MS);
  }

  // テスト用: pending な debounce を即時実行
  flushForTest(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.writeNow();
    }
  }

  // テスト用: consumeRestoreData の状態をリセット
  resetRestoreConsumedForTest(): void {
    this.restoreConsumed = false;
  }
}

export const sessionStateManager = new SessionStateManager();
