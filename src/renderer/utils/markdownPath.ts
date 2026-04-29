// ターミナル出力の中から「.md / .markdown ファイルパス」を検出して、絶対パスに
// 解決するための純粋関数群。xterm.js の registerLinkProvider から呼ばれる。
//
// 検出するパターン:
//   - 絶対 Unix パス     /Users/foo/bar.md
//   - チルダ展開         ~/dev/notes/foo.md
//   - 相対（カレント）   ./README.md
//   - 相対（親）         ../docs/foo.md
//   - サブディレクトリ   docs/setup.md
//   - 単独ファイル       README.md
//
// 一方で http(s) URL の中に含まれる .md（例: https://example.com/foo.md）は
// 既存の WebLinksAddon が拾う領分なので、ここでは除外する。

export interface MarkdownPathMatch {
  // 行内の文字オフセット（先頭=0）。xterm の col と同じ意味（ASCII 前提、
  // 多バイト文字は xterm 側の link decoration がずれる可能性があるが許容）
  start: number;
  end: number;
  // 検出した生の文字列（チルダ・相対表記をそのまま保持）
  raw: string;
}

// パス本体に許容する文字。空白 / 制御文字 / 引用符 / 山括弧 / カッコは終端扱い。
// 半角コロン `:` は path:line のような末尾装飾を切り落とすため一旦含めず、
// 検出後に末尾を整える。
const PATH_BODY = "[^\\s\"'`<>()\\[\\]{}|]+?";

// 拡張子: .md / .markdown のみ。case-insensitive。
const MD_EXT = "\\.(?:md|markdown)\\b";

// 単独ファイル名に許容する文字（先頭1要素は `/` を含めない）。
const FILENAME = "[A-Za-z0-9_.\\-]+?";

// 全パターンを 1 つの regex にまとめる（`g` フラグで複数マッチ）。
// グループ化はしない（マッチ全体だけ取れれば十分）。
const PATH_REGEX = new RegExp(
  [
    // ~/...md
    `~\\/${PATH_BODY}${MD_EXT}`,
    // /abs/...md
    `\\/${PATH_BODY}${MD_EXT}`,
    // ./relative.md / ../relative.md
    `\\.{1,2}\\/${PATH_BODY}${MD_EXT}`,
    // dir/file.md（最低 1 階層）
    `(?:[A-Za-z0-9_\\-][A-Za-z0-9_.\\-]*\\/)+${FILENAME}${MD_EXT}`,
    // 単独ファイル名
    `\\b${FILENAME}${MD_EXT}`,
  ].join("|"),
  "gi",
);

// http(s):// で始まるトークンの開始位置を全部抽出し、その範囲にあるマッチは
// MD パスでなく URL の一部とみなして除外する。
const URL_REGEX = /\bhttps?:\/\/\S+/gi;

/**
 * 1 行のテキストから Markdown ファイルパスらしきトークンをすべて抽出する。
 * 同じ範囲で URL とかぶっているものは除外する。
 */
export function findMarkdownPaths(line: string): MarkdownPathMatch[] {
  if (!line) return [];

  // URL の範囲を先に集める
  const urlRanges: Array<[number, number]> = [];
  for (const m of line.matchAll(URL_REGEX)) {
    if (m.index === undefined) continue;
    urlRanges.push([m.index, m.index + m[0].length]);
  }

  const matches: MarkdownPathMatch[] = [];
  for (const m of line.matchAll(PATH_REGEX)) {
    if (m.index === undefined) continue;
    let raw = m[0];
    let start = m.index;
    let end = start + raw.length;

    // URL 範囲と重なるなら除外
    if (urlRanges.some(([s, e]) => start < e && end > s)) continue;

    // 末尾の装飾文字（`,` `.` `:` `;` `)`）を切り落とす。`.md.` のように
    // ピリオドで終わるドキュメント表記をクリーンにする。
    while (end > start && /[.,:;)]$/.test(raw)) {
      raw = raw.slice(0, -1);
      end--;
    }
    if (raw.length === 0) continue;
    // 拡張子が落ちていたら除外（保険）
    if (!/\.(md|markdown)$/i.test(raw)) continue;

    matches.push({ start, end, raw });
  }

  // 同じ start で重複（複数の選択肢にマッチ）した場合は長い方を残す
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const dedup: MarkdownPathMatch[] = [];
  for (const m of matches) {
    const last = dedup[dedup.length - 1];
    if (last && m.start < last.end) continue; // 重複範囲は捨てる
    dedup.push(m);
  }
  return dedup;
}

/**
 * 検出した raw パスを絶対パスへ解決する。
 *  - `~` / `~/` は home に展開
 *  - 絶対 (`/...`) はそのまま
 *  - それ以外は cwd 起点で結合
 *
 * cwd / homeDir が空文字なら null を返す（開けない判定）。
 */
export function resolveMarkdownPath(
  raw: string,
  cwd: string | null,
  homeDir: string,
): string | null {
  if (!raw) return null;

  // チルダ
  if (raw === "~" || raw.startsWith("~/")) {
    if (!homeDir) return null;
    const rest = raw === "~" ? "" : raw.slice(2);
    return joinPath(homeDir, rest);
  }
  // 絶対
  if (raw.startsWith("/")) return normalizePath(raw);

  // 相対（cwd 必要）
  if (!cwd) return null;
  return joinPath(cwd, raw);
}

/**
 * absPath が baseCwd の配下（baseCwd 自身を含む）にあるかを判定する。
 * 単純な文字列前方一致 + 区切り境界の確認。
 */
export function isInsideCwd(absPath: string, baseCwd: string | null): boolean {
  if (!baseCwd) return false;
  const a = normalizePath(absPath);
  const b = normalizePath(baseCwd);
  if (a === b) return true;
  return a.startsWith(b.endsWith("/") ? b : b + "/");
}

// ===== 内部ヘルパ（path モジュールに依存しない、Renderer で完結） =====

function joinPath(base: string, rel: string): string {
  if (!rel) return normalizePath(base);
  // 相対 (`./foo` / `../foo`) もこのまま結合してから normalize で吸収
  const combined = base.endsWith("/") ? base + rel : base + "/" + rel;
  return normalizePath(combined);
}

function normalizePath(p: string): string {
  if (!p) return p;
  // 連続スラッシュを 1 つに
  let s = p.replace(/\/+/g, "/");
  // 末尾スラッシュ（root 以外）を除去
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  // `.` / `..` をスタックで解消
  const parts = s.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" && stack.length === 0) {
      // 先頭の "" = 絶対パスのルート印
      stack.push("");
      continue;
    }
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length > 1) stack.pop();
      // ルートを越えて遡らない
      continue;
    }
    stack.push(part);
  }
  if (stack.length === 1 && stack[0] === "") return "/";
  return stack.join("/");
}
