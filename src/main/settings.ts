import { app, BrowserWindow } from "electron";
import { join } from "path";
import fs from "fs";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  validateAppSettings,
  type AppSettings,
  type PartialAppSettings,
} from "../shared/settings";

const SAVE_DEBOUNCE_MS = 250;

class SettingsManager {
  private filePath: string;
  private settings: AppSettings = DEFAULT_SETTINGS;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.filePath = join(app.getPath("userData"), "settings.json");
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.settings = validateAppSettings(null);
        return;
      }
      const raw: unknown = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      // 設定はフィールド単位でフォールバックするため、必ず正規化済みの値が返る
      this.settings = validateAppSettings(raw);
    } catch {
      // 破損 / パース失敗 → デフォルトで起動。次回 update 時に上書きされる
      this.settings = validateAppSettings(null);
    }
  }

  private writeNow(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2));
    } catch (e) {
      console.warn("[Settings] save error:", e);
    }
  }

  // 全ウィンドウへ設定変更を通知。settings を購読している renderer 側
  // ストアが反映する（自分で update を発行したウィンドウも含めて統一する）。
  private broadcastChange(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("settings:changed", this.settings);
      }
    }
  }

  get(): AppSettings {
    return this.settings;
  }

  // 部分パッチを当てて保存。debounce 後にファイル書込と broadcast を行う。
  // ただしメモリ上の値は同期的に更新するため、直後の get() は新しい値を返す。
  update(patch: PartialAppSettings): AppSettings {
    this.settings = mergeSettings(this.settings, patch);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.writeNow();
    }, SAVE_DEBOUNCE_MS);
    // 通知は debounce せず即時。renderer 側の UI 反映を遅延させない。
    this.broadcastChange();
    return this.settings;
  }

  // 完全置換（テスト用 / リセット用）
  replace(next: AppSettings): AppSettings {
    this.settings = validateAppSettings(next);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.writeNow();
    }, SAVE_DEBOUNCE_MS);
    this.broadcastChange();
    return this.settings;
  }

  // テスト用: pending な debounce を即時実行
  flushForTest(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.writeNow();
    }
  }
}

export const settingsManager = new SettingsManager();
