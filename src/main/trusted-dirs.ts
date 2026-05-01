import { app } from "electron";
import { join } from "path";
import fs from "fs";
import os from "os";

// Chat 起動前の信頼確認用に、ユーザーが明示的に信頼した CWD 一覧を永続化する。
// $HOME そのもの（例: /Users/newlife）は仕様上「常にセンシティブ」扱いで、
// 信頼リストに加えても無視する（毎回確認モーダルを出す）。
//
// ファイル: app.getPath("userData")/trusted-dirs.json
// フォーマット: { paths: string[] }（重複なし、絶対パス、最大 256 件）

const MAX_ENTRIES = 256;
const homeDir = os.homedir();

interface TrustedDirsFile {
  paths: string[];
}

class TrustedDirsManager {
  private filePath: string;
  private paths: Set<string> = new Set();
  private loaded = false;

  constructor() {
    this.filePath = join(app.getPath("userData"), "trusted-dirs.json");
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const data = JSON.parse(raw) as TrustedDirsFile;
        if (data && Array.isArray(data.paths)) {
          for (const p of data.paths) {
            if (typeof p === "string" && p.length > 0) this.paths.add(p);
          }
        }
      }
    } catch {
      this.paths = new Set();
    }
  }

  private save(): void {
    try {
      const arr = Array.from(this.paths).slice(0, MAX_ENTRIES);
      const payload: TrustedDirsFile = { paths: arr };
      fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2));
    } catch (e) {
      console.warn("[TrustedDirs] save error:", e);
    }
  }

  // $HOME そのものは仕様上「常に未信頼」（毎回確認）扱いとする。
  isHome(cwd: string): boolean {
    return cwd === homeDir;
  }

  isTrusted(cwd: string): boolean {
    if (!cwd) return false;
    if (this.isHome(cwd)) return false;
    this.ensureLoaded();
    return this.paths.has(cwd);
  }

  trust(cwd: string): void {
    if (!cwd) return;
    if (this.isHome(cwd)) return; // 永続化しない
    this.ensureLoaded();
    if (this.paths.has(cwd)) return;
    this.paths.add(cwd);
    this.save();
  }

  // テスト・将来の設定 UI 用。
  list(): string[] {
    this.ensureLoaded();
    return Array.from(this.paths);
  }
}

export const trustedDirsManager = new TrustedDirsManager();
