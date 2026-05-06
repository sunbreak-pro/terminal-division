/// <reference types="vite/client" />
// `material-icon-theme` の manifest を実行時に組み立て、ファイル名 / フォルダ名から
// 対応 SVG の URL を解決するヘルパ。
//
// 設計:
// - SVG は `node_modules/material-icon-theme/icons/*.svg` (1238 個)。
//   `import.meta.glob` の `?url` で **アセットとして** バンドルし、basename → URL
//   のマップを作る。実 fetch はブラウザが `<img src>` に出会った時にだけ走るので、
//   起動時バンドルサイズには影響しない (URL 文字列のみ載る)。
// - manifest はライブラリの `generateManifest()` をモジュールロード時 1 回だけ実行。
// - VSCode の Material Icon Theme は `languageIds` (= VSCode の言語判定結果) に依存
//   しているため、`.ts` 等の拡張子は `fileExtensions` に存在せず `languageIds` 側にある。
//   このヘルパは「拡張子 → 言語ID」の小さな fallback テーブルを持ち、`fileExtensions`
//   で見つからなかった場合だけ `languageIds` を参照する。
//
// 解決順序 (ファイル):
//   1. 完全一致のファイル名 (`fileNames`) — 例: `package.json`, `.gitignore`
//   2. 拡張子最長一致 (`fileExtensions`) — 例: `foo.test.ts` → `test.ts` → `ts`
//   3. 拡張子 → 言語ID マッピング → `languageIds`
//   4. デフォルト (`manifest.file`)
//
// 解決順序 (フォルダ):
//   1. フォルダ名一致 (`folderNames` / `folderNamesExpanded`)
//   2. デフォルト (`manifest.folder` / `manifest.folderExpanded`)

import { generateManifest, type Manifest } from "material-icon-theme";

// Vite が node_modules 配下の SVG をビルド時にアセット化し、URL 文字列を返す。
// `eager: true` で同期的にロードして basename → URL の Map を作る。
//
// 重要: electron-vite の renderer は `src/renderer/` を Vite の root として
// 扱うため、絶対 glob (`/node_modules/...`) では **src/renderer/node_modules/**
// として解決されてしまい、実 node_modules に届かない (build しても 1238 個の
// SVG が一切含まれない問題があった)。
// 一方 vitest はプロジェクトルートが Vite root なので、絶対 glob でもテストは
// 通ってしまう。両環境で確実に解決させるため **ソースファイルからの相対 glob**
// を使う。`src/renderer/utils/` から `node_modules/material-icon-theme/icons/`
// までは 3 階層上。
const iconUrlModules = import.meta.glob<string>(
  "../../../node_modules/material-icon-theme/icons/*.svg",
  { eager: true, query: "?url", import: "default" },
);

const urlByBasename = new Map<string, string>();
for (const [path, url] of Object.entries(iconUrlModules)) {
  const file = path.split("/").pop();
  if (!file) continue;
  const basename = file.replace(/\.svg$/i, "");
  urlByBasename.set(basename, url);
}

const manifest: Manifest = generateManifest();

// VSCode の言語判定に依存している主要拡張子の fallback。
// material-icon-theme の `languageIds` を引くためのキーを引っ張れるようにする。
// すべて lower-case で扱う。
const EXT_TO_LANGUAGE_ID: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
  // tsx は fileExtensions 側に既にあるので不要
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  pl: "perl",
  lua: "lua",
  r: "r",
  dart: "dart",
  scala: "scala",
  groovy: "groovy",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "shellscript",
  ps1: "powershell",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  styl: "stylus",
  vue: "vue",
  svelte: "svelte",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  json: "json",
  jsonc: "jsonc",
  json5: "json",
  xml: "xml",
  ini: "ini",
  env: "dotenv",
};

function definitionToUrl(defName: string | undefined | null): string | null {
  if (!defName) return null;
  const def = manifest.iconDefinitions?.[defName];
  if (!def) return null;
  const file = def.iconPath.split("/").pop();
  if (!file) return null;
  const basename = file.replace(/\.svg$/i, "");
  return urlByBasename.get(basename) ?? null;
}

/**
 * ファイル名から SVG URL を返す。見つからなければデフォルトの汎用ファイルアイコン。
 * basename だけでなく `foo.test.ts` のような複合拡張子も longest-first で照合する。
 */
export function getFileIconUrl(fileName: string): string | null {
  if (!fileName) return definitionToUrl(manifest.file);
  const lower = fileName.toLowerCase();

  // 1. ファイル名一致 (.gitignore / package.json / Dockerfile 等)
  const byName = manifest.fileNames?.[lower];
  if (byName) {
    const url = definitionToUrl(byName);
    if (url) return url;
  }

  // 2. 拡張子最長一致 (`foo.test.ts` → 試す順: test.ts, ts)
  const dotIdx = lower.indexOf(".");
  if (dotIdx >= 0) {
    const exts: string[] = [];
    let i = dotIdx;
    while (i >= 0) {
      exts.push(lower.slice(i + 1)); // 先頭の `.` を除く
      i = lower.indexOf(".", i + 1);
    }
    // 長い順
    exts.sort((a, b) => b.length - a.length);
    for (const ext of exts) {
      const def = manifest.fileExtensions?.[ext];
      if (def) {
        const url = definitionToUrl(def);
        if (url) return url;
      }
    }
    // 3. 言語ID fallback (.ts などはここに来る。短い拡張子から試す)
    for (let j = exts.length - 1; j >= 0; j--) {
      const langId = EXT_TO_LANGUAGE_ID[exts[j]];
      if (!langId) continue;
      const def = manifest.languageIds?.[langId];
      if (def) {
        const url = definitionToUrl(def);
        if (url) return url;
      }
    }
  }

  // 4. デフォルト
  return definitionToUrl(manifest.file);
}

/**
 * フォルダ名から SVG URL を返す。
 * `expanded` が true なら開いた状態用の名前を優先する。
 */
export function getFolderIconUrl(
  folderName: string,
  expanded = false,
): string | null {
  if (!folderName) {
    return definitionToUrl(
      expanded ? manifest.folderExpanded : manifest.folder,
    );
  }
  const lower = folderName.toLowerCase();

  if (expanded) {
    const namedExp = manifest.folderNamesExpanded?.[lower];
    if (namedExp) {
      const url = definitionToUrl(namedExp);
      if (url) return url;
    }
  } else {
    const named = manifest.folderNames?.[lower];
    if (named) {
      const url = definitionToUrl(named);
      if (url) return url;
    }
  }

  return definitionToUrl(expanded ? manifest.folderExpanded : manifest.folder);
}

// テスト用にエクスポート (本番コードからは参照しない)
export const __TEST__ = {
  manifest,
  urlByBasename,
  EXT_TO_LANGUAGE_ID,
};
