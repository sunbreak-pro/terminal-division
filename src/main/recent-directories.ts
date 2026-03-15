import { app } from "electron";
import { join } from "path";
import fs from "fs";
import os from "os";

interface RecentDirectory {
  path: string;
  lastUsed: number;
}

type ChangeCallback = () => void;

const MAX_ENTRIES = 10;
const homeDir = os.homedir();

class RecentDirectoryManager {
  private filePath: string;
  private directories: RecentDirectory[] = [];
  private listeners: ChangeCallback[] = [];

  constructor() {
    this.filePath = join(app.getPath("userData"), "recent-directories.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
        this.directories = Array.isArray(data) ? data : [];
      }
    } catch {
      this.directories = [];
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.directories, null, 2),
      );
    } catch (e) {
      console.warn("[RecentDirectories] save error:", e);
    }
  }

  private notify(): void {
    for (const cb of this.listeners) {
      cb();
    }
  }

  addDirectory(dirPath: string): void {
    // ホームディレクトリは除外
    if (dirPath === homeDir) return;

    // 重複除去
    this.directories = this.directories.filter((d) => d.path !== dirPath);

    // 先頭に追加
    this.directories.unshift({ path: dirPath, lastUsed: Date.now() });

    // 最大件数に制限
    if (this.directories.length > MAX_ENTRIES) {
      this.directories = this.directories.slice(0, MAX_ENTRIES);
    }

    this.save();
    this.notify();
  }

  getDirectories(): RecentDirectory[] {
    // 存在チェック付きで取得（存在しないディレクトリを除去）
    const valid = this.directories.filter((d) => {
      try {
        return fs.existsSync(d.path) && fs.statSync(d.path).isDirectory();
      } catch {
        return false;
      }
    });

    // 無効なエントリがあった場合は保存し直す
    if (valid.length !== this.directories.length) {
      this.directories = valid;
      this.save();
    }

    return valid;
  }

  onChange(callback: ChangeCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }
}

export const recentDirectoryManager = new RecentDirectoryManager();
