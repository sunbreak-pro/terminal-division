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
  // 連続したエラー件数。閾値超過で renderer に通知し count をリセット。
  errorCount: number;
  // 計測ウィンドウの起点。WATCHER_ERROR_WINDOW_MS を超えたら count を 0 に戻す。
  errorWindowStart: number;
}

// 閾値: 5 分間で 5 件以上のエラーが起きたら 1 度だけ通知
const WATCHER_ERROR_THRESHOLD = 5;
const WATCHER_ERROR_WINDOW_MS = 5 * 60 * 1000;

class FileSystemManager {
  private watchers: Map<string, WatchEntry> = new Map();

  /**
   * ルート配下を再帰探索し、ファイル/ディレクトリ名にクエリ(部分一致, 大文字小文字無視)
   * を含むエントリを返す。サイドバー検索フィールドからのみ呼ばれる。
   *
   * 上限とスキップ:
   * - maxResults: 結果件数上限（既定 500）。超過時は walk を打ち切る
   * - maxDepth: 走査深度上限（既定 10）
   * - スキップ対象: node_modules / .git のみ。`.claude` 等の dotfile は探索対象に含む
   * - シンボリックリンクのディレクトリは再帰しない（ループ回避）
   */
  async searchTree(
    rootPath: string,
    query: string,
    options?: { maxResults?: number; maxDepth?: number },
  ): Promise<{ entries: DirEntry[]; truncated: boolean }> {
    const trimmed = query.trim();
    if (!trimmed) return { entries: [], truncated: false };
    const q = trimmed.toLowerCase();
    const maxResults = options?.maxResults ?? 500;
    const maxDepth = options?.maxDepth ?? 10;
    const SKIP_DIRS = new Set(["node_modules", ".git"]);

    const results: DirEntry[] = [];
    let truncated = false;

    const walk = async (dirPath: string, depth: number): Promise<void> => {
      if (truncated) return;
      if (depth > maxDepth) return;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      } catch {
        return;
      }
      // 結果順を安定化させるため、ディレクトリ → ファイル順 + ロケール順で走査
      entries.sort((a, b) => {
        const aDir = a.isDirectory();
        const bDir = b.isDirectory();
        if (aDir !== bDir) return aDir ? -1 : 1;
        return a.name.localeCompare(b.name, "ja");
      });
      for (const entry of entries) {
        if (truncated) return;
        const full = path.join(dirPath, entry.name);
        const isSymlink = entry.isSymbolicLink();
        let isDir = entry.isDirectory();
        if (isSymlink) {
          try {
            const stat = await fs.promises.stat(full);
            isDir = stat.isDirectory();
          } catch {
            isDir = false;
          }
        }
        if (entry.name.toLowerCase().includes(q)) {
          if (results.length >= maxResults) {
            truncated = true;
            return;
          }
          results.push({
            name: entry.name,
            path: full,
            isDirectory: isDir,
            isSymlink,
          });
        }
        if (isDir && !isSymlink && !SKIP_DIRS.has(entry.name)) {
          await walk(full, depth + 1);
        }
      }
    };
    await walk(rootPath, 0);
    return { entries: results, truncated };
  }

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
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[fs:watch] ${dirPath}:`, e);
      this.recordWatcherError(dirPath, message);
    });

    this.watchers.set(dirPath, {
      watcher,
      refCount: 1,
      windowIds: new Set([windowId]),
      errorCount: 0,
      errorWindowStart: Date.now(),
    });
  }

  // chokidar の error 連発を 5 分間で 5 件超えたら一度だけ renderer へ通知し、
  // 計測ウィンドウをリセットする。連投で toast が嵐にならないようにする。
  private recordWatcherError(dirPath: string, message: string): void {
    const entry = this.watchers.get(dirPath);
    if (!entry) return;
    const now = Date.now();
    if (now - entry.errorWindowStart > WATCHER_ERROR_WINDOW_MS) {
      entry.errorWindowStart = now;
      entry.errorCount = 0;
    }
    entry.errorCount += 1;
    if (entry.errorCount < WATCHER_ERROR_THRESHOLD) return;

    // 閾値到達 → 通知してウィンドウをリセット
    entry.errorCount = 0;
    entry.errorWindowStart = now;
    for (const wid of entry.windowIds) {
      const win = BrowserWindow.fromId(wid);
      if (win && !win.isDestroyed()) {
        win.webContents.send("fs:watcherError", { dirPath, message });
      }
    }
  }

  unwatch(dirPath: string, windowId: number): void {
    const entry = this.watchers.get(dirPath);
    if (!entry) return;
    // 同ウィンドウから複数 ref がある場合（同パスを別コンポーネントから watch）も
    // refCount で正しく管理する。windowIds は Set なので delete は idempotent。
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      void entry.watcher.close();
      this.watchers.delete(dirPath);
      return;
    }
    // ウィンドウが完全に手放したかどうかは外部に把握していないため、
    // refCount が 0 になったときの最終 unwatch でのみ Set から削除する。
    // ただし unwatchAllForWindow / window destroy 経路で取りこぼしがあった場合の
    // 防衛として、close 済みウィンドウの ID は除去しておく
    for (const wid of entry.windowIds) {
      const win = BrowserWindow.fromId(wid);
      if (!win || win.isDestroyed()) {
        entry.windowIds.delete(wid);
      }
    }
    if (windowId !== undefined && entry.windowIds.size === 0) {
      // windowIds が空 = 参照しているウィンドウが全て閉じている → 強制 close
      void entry.watcher.close();
      this.watchers.delete(dirPath);
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

  // utf-8 テキストファイルの読込。サイズ上限を超える場合はエラー。
  // Markdown エディタが対象。バイナリ判定は呼び出し側 (拡張子判定) に任せる。
  async readTextFile(
    filePath: string,
    maxBytes: number,
  ): Promise<{ content: string; size: number }> {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      throw new Error("ファイルではありません");
    }
    if (stat.size > maxBytes) {
      throw new Error(
        `ファイルサイズが上限 (${Math.floor(maxBytes / 1024 / 1024)}MB) を超えています`,
      );
    }
    const content = await fs.promises.readFile(filePath, { encoding: "utf-8" });
    return { content, size: stat.size };
  }

  async writeTextFile(filePath: string, content: string): Promise<void> {
    // 既存パスがディレクトリだった場合の事故を防ぐ
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        throw new Error("書き込み先がファイルではありません");
      }
    } catch (e) {
      // ENOENT (新規作成) は許容するが、本機能では既存 .md の更新しか想定しない
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await fs.promises.writeFile(filePath, content, { encoding: "utf-8" });
  }

  async openInVSCode(targetPath: string): Promise<boolean> {
    // shell:false + argv 配列で実行。targetPath にバッククオートや $() があっても
    // shell が解釈せず、command injection を回避できる
    const trySpawn = (cmd: string, args: string[]): Promise<boolean> =>
      new Promise((resolve) => {
        const proc = spawn(cmd, args, {
          shell: false,
          detached: true,
          stdio: "ignore",
          env: process.env,
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

    // まず PATH 上の `code` を試し、失敗したら macOS の `open -a` でフォールバック。
    // パッケージ版でも /Applications 配下を直接起動できるため、ユーザーが Shell Command:
    // Install 'code' command を未実行でも VSCode が開ける
    if (await trySpawn("code", [targetPath])) return true;
    if (process.platform === "darwin") {
      return trySpawn("open", ["-a", "Visual Studio Code", targetPath]);
    }
    return false;
  }

  closeAll(): void {
    for (const entry of this.watchers.values()) {
      void entry.watcher.close();
    }
    this.watchers.clear();
  }
}

export const fileSystemManager = new FileSystemManager();
