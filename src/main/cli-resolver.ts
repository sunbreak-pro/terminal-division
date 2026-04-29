import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getMergedPath } from "./shell-integration";

// 解決済みバイナリのキャッシュ。CLI のインストール状況が起動中に変わることは稀なので
// 最初に見つけたものを保持する。null（未設定 = キャッシュ無効）と false（未発見 = キャッシュあり）を区別する。
let cachedClaudeBinary: string | null | false = null;

/**
 * `claude` バイナリの絶対パスを解決する。
 *
 * 解決順序:
 * 1. `getMergedPath()` の各ディレクトリを順に走査し、`claude` （実行可能ファイル）を探す
 * 2. 見つからなければ well-known fallback（`~/.local/bin/claude`）を確認
 * 3. それでも無ければ null
 *
 * 結果はプロセス内でキャッシュされ、再呼び出し時は再走査しない。
 * インストール状況が変わった場合は `clearClaudeBinaryCache()` で無効化できる。
 */
export function resolveClaudeBinary(): string | null {
  if (cachedClaudeBinary === false) return null;
  if (cachedClaudeBinary !== null) return cachedClaudeBinary;

  const mergedPath = getMergedPath();
  const dirs = mergedPath.split(":").filter((d) => d.length > 0);
  for (const dir of dirs) {
    const candidate = path.join(dir, "claude");
    if (isExecutable(candidate)) {
      cachedClaudeBinary = candidate;
      return candidate;
    }
  }

  // well-known fallback (`claude` の標準的なインストール先)
  const home = os.homedir();
  const fallback = path.join(home, ".local", "bin", "claude");
  if (isExecutable(fallback)) {
    cachedClaudeBinary = fallback;
    return fallback;
  }

  cachedClaudeBinary = false;
  return null;
}

/**
 * テスト用 / 再走査用にキャッシュを破棄する。
 */
export function clearClaudeBinaryCache(): void {
  cachedClaudeBinary = null;
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    const stat = fs.statSync(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}
