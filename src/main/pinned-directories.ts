// ユーザが「サイドバーにツリーをピン留めした」追加 CWD の永続管理。
// 起動中のペインに紐付かないツリーを残しておくための機能 (recent-directories と
// 似たデータ構造だが、別ファイル / 別ストレージで管理する)。
//
// - 順序保持: ユーザが追加した順を維持する (最近使用順では上書きしない)
// - サイズ上限: 過剰ピン留めを防ぐ。追加時に古いものから捨てる
// - 検証: getDirectories 時に「実在するディレクトリだけ」を返す。失われたパスは
//   1 度の get で永続データから除去する

import { app } from "electron";
import { join } from "path";
import fs from "fs";
import {
  registerDynamicAllowedPath,
  unregisterDynamicAllowedPath,
} from "./path-validator";

const MAX_ENTRIES = 50;

class PinnedDirectoryManager {
  private filePath: string;
  private directories: string[] = [];

  constructor() {
    this.filePath = join(app.getPath("userData"), "pinned-directories.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
        if (Array.isArray(data)) {
          this.directories = data
            .filter((x): x is string => typeof x === "string" && x.length > 0)
            .slice(0, MAX_ENTRIES);
        }
      }
    } catch {
      this.directories = [];
    }
    // 起動時: 永続化されていたパスを動的 allow リストに登録
    // (これらは過去にユーザが OS ダイアログで明示的に選んだもの)
    for (const p of this.directories) registerDynamicAllowedPath(p);
  }

  private save(): void {
    try {
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.directories, null, 2),
      );
    } catch (e) {
      console.warn("[PinnedDirectories] save error:", e);
    }
  }

  /** 永続データを実在チェック付きで返す。失われたパスは保存し直す */
  getDirectories(): string[] {
    const valid = this.directories.filter((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
    if (valid.length !== this.directories.length) {
      this.directories = valid;
      this.save();
    }
    return [...valid];
  }

  /** 末尾に追加 (重複なら無視)。max 超過は古いものから除去 */
  add(dirPath: string): boolean {
    if (typeof dirPath !== "string" || dirPath.length === 0) return false;
    if (!dirPath.startsWith("/")) return false; // 絶対パスのみ
    try {
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        return false;
      }
    } catch {
      return false;
    }
    // 動的 allow リストに登録 (fs:readDir 等の downstream 操作を許可)
    registerDynamicAllowedPath(dirPath);
    if (this.directories.includes(dirPath)) return true;
    this.directories.push(dirPath);
    if (this.directories.length > MAX_ENTRIES) {
      // 古い 1 件は dynamic allow からは外さない (他の機能でまだ使われ得るため)
      this.directories = this.directories.slice(-MAX_ENTRIES);
    }
    this.save();
    return true;
  }

  /** 指定パスを除去。なければ false */
  remove(dirPath: string): boolean {
    const before = this.directories.length;
    this.directories = this.directories.filter((p) => p !== dirPath);
    if (this.directories.length === before) return false;
    unregisterDynamicAllowedPath(dirPath);
    this.save();
    return true;
  }
}

export const pinnedDirectoryManager = new PinnedDirectoryManager();
