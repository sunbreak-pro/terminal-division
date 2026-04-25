import { BrowserWindow, shell } from "electron";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import chokidar, { type FSWatcher } from "chokidar";

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface FsChangePayload {
  watchedPath: string;
  type: "add" | "addDir" | "unlink" | "unlinkDir" | "change";
  changedPath: string;
}

interface WatchEntry {
  watcher: FSWatcher;
  refCount: number;
  windowIds: Set<number>;
}

class FileSystemManager {
  private watchers: Map<string, WatchEntry> = new Map();

  async readDir(dirPath: string): Promise<DirEntry[]> {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const results: DirEntry[] = [];
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      let isDir = entry.isDirectory();
      const isSymlink = entry.isSymbolicLink();
      // シンボリックリンクは実体を解決して isDirectory 判定（失敗時はファイル扱い）
      if (isSymlink) {
        try {
          const stat = await fs.promises.stat(full);
          isDir = stat.isDirectory();
        } catch {
          isDir = false;
        }
      }
      results.push({
        name: entry.name,
        path: full,
        isDirectory: isDir,
        isSymlink,
      });
    }
    // ディレクトリ → ファイル順、ロケール順
    results.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, "ja");
    });
    return results;
  }

  watch(dirPath: string, windowId: number): void {
    const existing = this.watchers.get(dirPath);
    if (existing) {
      existing.refCount += 1;
      existing.windowIds.add(windowId);
      return;
    }

    const watcher = chokidar.watch(dirPath, {
      persistent: true,
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });

    const broadcast = (
      type: FsChangePayload["type"],
      changedPath: string,
    ): void => {
      const payload: FsChangePayload = {
        watchedPath: dirPath,
        type,
        changedPath,
      };
      const entry = this.watchers.get(dirPath);
      if (!entry) return;
      for (const wid of entry.windowIds) {
        const win = BrowserWindow.fromId(wid);
        if (win && !win.isDestroyed()) {
          win.webContents.send("fs:change", payload);
        }
      }
    };

    watcher.on("add", (p) => broadcast("add", p));
    watcher.on("addDir", (p) => broadcast("addDir", p));
    watcher.on("unlink", (p) => broadcast("unlink", p));
    watcher.on("unlinkDir", (p) => broadcast("unlinkDir", p));
    watcher.on("change", (p) => broadcast("change", p));
    watcher.on("error", (e) => {
      console.warn(`[fs:watch] ${dirPath}:`, e);
    });

    this.watchers.set(dirPath, {
      watcher,
      refCount: 1,
      windowIds: new Set([windowId]),
    });
  }

  unwatch(dirPath: string, windowId: number): void {
    const entry = this.watchers.get(dirPath);
    if (!entry) return;
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      void entry.watcher.close();
      this.watchers.delete(dirPath);
    } else {
      // refCount > 0 でも、最後に当該ウィンドウを参照していなければ Set から消す
      // 実装簡略化: 別ウィンドウが同パスを開いているかは外部に把握していないので、
      // refCount のみで判断する
      void windowId; // 将来用
    }
  }

  unwatchAllForWindow(windowId: number): void {
    for (const [dirPath, entry] of this.watchers.entries()) {
      if (entry.windowIds.has(windowId)) {
        entry.windowIds.delete(windowId);
        entry.refCount = Math.max(0, entry.refCount - 1);
        if (entry.refCount === 0) {
          void entry.watcher.close();
          this.watchers.delete(dirPath);
        }
      }
    }
  }

  async rename(oldPath: string, newName: string): Promise<string> {
    if (newName.includes("/") || newName.includes("\\")) {
      throw new Error("名前にパス区切り文字を含めることはできません");
    }
    if (newName.length === 0) {
      throw new Error("名前が空です");
    }
    const newPath = path.join(path.dirname(oldPath), newName);
    if (newPath === oldPath) return oldPath;
    await fs.promises.rename(oldPath, newPath);
    return newPath;
  }

  async moveToDir(srcPath: string, destDir: string): Promise<string> {
    const stat = await fs.promises.stat(destDir);
    if (!stat.isDirectory()) {
      throw new Error("移動先がディレクトリではありません");
    }
    const newPath = path.join(destDir, path.basename(srcPath));
    if (newPath === srcPath) return srcPath;
    await fs.promises.rename(srcPath, newPath);
    return newPath;
  }

  async trash(targetPath: string): Promise<void> {
    await shell.trashItem(targetPath);
  }

  /**
   * ゴミ箱に入れた後の場所を ~/.Trash 配下の差分から検出して返す。
   * 外部ボリュームに移動された場合や検出失敗時は trashedAt を null で返す。
   */
  async trashWithTracking(
    targetPath: string,
  ): Promise<{ trashedAt: string | null }> {
    const trashDir = path.join(os.homedir(), ".Trash");
    let before = new Set<string>();
    try {
      before = new Set(await fs.promises.readdir(trashDir));
    } catch {
      // .Trash が無いケース等は単に空とする
    }
    await shell.trashItem(targetPath);
    let trashedAt: string | null = null;
    try {
      const after = await fs.promises.readdir(trashDir);
      const newItems = after.filter((n) => !before.has(n));
      const baseName = path.basename(targetPath);
      // 同名優先、無ければ stat の更新時刻が最新のものを採用
      let candidate = newItems.find((n) => n === baseName);
      if (!candidate && newItems.length > 0) {
        let latest = -Infinity;
        for (const name of newItems) {
          try {
            const stat = await fs.promises.stat(path.join(trashDir, name));
            if (stat.mtimeMs > latest) {
              latest = stat.mtimeMs;
              candidate = name;
            }
          } catch {
            /* ignore */
          }
        }
      }
      if (candidate) {
        trashedAt = path.join(trashDir, candidate);
      }
    } catch {
      /* ignore */
    }
    return { trashedAt };
  }

  /**
   * ゴミ箱から元の場所へファイル/ディレクトリを戻す。
   * 元の場所に同名が存在する場合・trashedAt が存在しない場合はエラー。
   */
  async restoreFromTrash(
    trashedAt: string,
    originalPath: string,
  ): Promise<void> {
    try {
      await fs.promises.access(trashedAt);
    } catch {
      throw new Error("ゴミ箱から対象が見つかりません(既に削除された可能性)");
    }
    try {
      await fs.promises.access(originalPath);
      throw new Error("元の場所に同名のアイテムが存在します");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    // 親ディレクトリが消えていれば作成
    const parent = path.dirname(originalPath);
    try {
      await fs.promises.access(parent);
    } catch {
      await fs.promises.mkdir(parent, { recursive: true });
    }
    await fs.promises.rename(trashedAt, originalPath);
  }

  /**
   * ファイル/ディレクトリを別ディレクトリへ移動(ダイアログを開かない直接版)。
   * D&D での move 操作などに使う。
   */
  async movePath(srcPath: string, destDir: string): Promise<string> {
    const stat = await fs.promises.stat(destDir);
    if (!stat.isDirectory()) {
      throw new Error("移動先がディレクトリではありません");
    }
    // src を dest の子に入れない (e.g. ディレクトリを自分自身の子へ移動)
    const normalizedSrc = path.resolve(srcPath);
    const normalizedDest = path.resolve(destDir);
    if (
      normalizedDest === normalizedSrc ||
      normalizedDest.startsWith(normalizedSrc + path.sep)
    ) {
      throw new Error("移動先が自分自身またはその子孫です");
    }
    const newPath = path.join(destDir, path.basename(srcPath));
    if (newPath === srcPath) return srcPath;
    try {
      await fs.promises.access(newPath);
      throw new Error("移動先に同名のアイテムが既に存在します");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await fs.promises.rename(srcPath, newPath);
    return newPath;
  }

  /**
   * ファイル/ディレクトリを別ディレクトリへ再帰的にコピー。
   * 外部 Finder からツリーへ取り込む際などに使う。
   */
  async copyPath(srcPath: string, destDir: string): Promise<string> {
    const stat = await fs.promises.stat(destDir);
    if (!stat.isDirectory()) {
      throw new Error("コピー先がディレクトリではありません");
    }
    const baseName = path.basename(srcPath);
    let newPath = path.join(destDir, baseName);
    // 同名衝突時は " copy"・" copy 2" のように suffix を付ける
    let collision = 0;
    while (true) {
      try {
        await fs.promises.access(newPath);
        collision += 1;
        const ext = path.extname(baseName);
        const stem = baseName.slice(0, baseName.length - ext.length);
        const suffix = collision === 1 ? " copy" : ` copy ${collision}`;
        newPath = path.join(destDir, `${stem}${suffix}${ext}`);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") break;
        throw e;
      }
    }
    await fs.promises.cp(srcPath, newPath, {
      recursive: true,
      errorOnExist: true,
      preserveTimestamps: true,
    });
    return newPath;
  }

  async openInVSCode(targetPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      // shell:true で PATH 解決を任せる。code が無ければ ENOENT ではなく終了コード 127 で出る
      const proc = spawn(`code "${targetPath.replace(/"/g, '\\"')}"`, {
        shell: true,
        detached: true,
        stdio: "ignore",
      });
      let resolved = false;
      proc.on("error", () => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });
      proc.on("spawn", () => {
        proc.unref();
        // spawn 後すぐ exit したら失敗として扱う
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve(true);
          }
        }, 200);
      });
      proc.on("exit", (code) => {
        if (!resolved) {
          resolved = true;
          resolve(code === 0);
        }
      });
    });
  }

  closeAll(): void {
    for (const entry of this.watchers.values()) {
      void entry.watcher.close();
    }
    this.watchers.clear();
  }
}

export const fileSystemManager = new FileSystemManager();
