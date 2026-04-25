import * as path from "path";
import * as os from "os";

// renderer 側からの任意文字列を信頼してそのまま fs API に渡すと、
// path traversal や `/etc/passwd` 等のシステム領域への偶発的アクセスを許してしまう。
// 開発者向けターミナルアプリの利用想定上、ホーム配下と外部ボリューム / 一時領域だけを許可する。
//
// 完全な防御ではない（symlink 経由のエスケープは realpath を取らないため検出されない）が、
// 明白な path traversal や typo / 悪意ある drag-drop で `/etc` 等を触りに行くのを止める。
//
// 注意: macOS の `/Users/<name>` は `/private/Users/<name>` の symlink ではないため、
// homedir() の戻り値で十分。`/private/var/folders` は macOS の一時領域。
const ALLOWED_PREFIXES = [
  os.homedir(),
  "/Volumes",
  "/tmp",
  "/private/tmp",
  "/var/folders",
  "/private/var/folders",
];

/**
 * renderer から渡されたパス文字列を正規化し、許可された境界内にあるかを検証する。
 * 許可境界外 / 非文字列 / 空文字列の場合は null を返す。
 * 戻り値は path.resolve 後の絶対パスなので、以降はそれを使うこと。
 */
export function validatePath(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0) return null;
  let resolved: string;
  try {
    resolved = path.resolve(input);
  } catch {
    return null;
  }
  for (const prefix of ALLOWED_PREFIXES) {
    if (resolved === prefix || resolved.startsWith(prefix + path.sep)) {
      return resolved;
    }
  }
  return null;
}

export const PATH_REJECTED_ERROR = "許可されていないパスです";
