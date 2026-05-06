import { describe, it, expect } from "vitest";
import {
  getFileIconUrl,
  getFolderIconUrl,
  __TEST__,
} from "../materialIconResolver";

// 真の `material-icon-theme` パッケージから生成される manifest を使った統合テスト。
// Vite の `?url` import は SVG を data URI もしくはハッシュ付きアセットパスへ
// 変換するため、URL 文字列の「中身」で routing を判定するのは脆い。代わりに
// 「異なる入力が異なる URL を返す」「未知入力がデフォルトと一致する」という
// 関係性で routing を検証する。

describe("materialIconResolver", () => {
  describe("getFileIconUrl", () => {
    it("ファイル名一致 (package.json) で URL を返す", () => {
      expect(getFileIconUrl("package.json")).toBeTruthy();
    });

    it("ファイル名一致は拡張子だけの場合と異なる URL を返す", () => {
      // package.json は fileNames で nodejs/json 等の専用アイコンが付くため、
      // 単なる .json (json アイコン) とは別の URL になるはず。
      const named = getFileIconUrl("package.json");
      const ext = getFileIconUrl("foo.json");
      expect(named).toBeTruthy();
      expect(ext).toBeTruthy();
      expect(named).not.toBe(ext);
    });

    it("拡張子のみ (App.tsx) で react_ts アイコンを返す (= 別ファイルと異なる URL)", () => {
      const tsx = getFileIconUrl("App.tsx");
      const txt = getFileIconUrl("foo.txt");
      expect(tsx).toBeTruthy();
      expect(txt).toBeTruthy();
      expect(tsx).not.toBe(txt);
    });

    it(".ts は languageIds 経由 (typescript) で解決され、tsx と異なる URL", () => {
      // .ts は manifest.fileExtensions に存在せず、EXT_TO_LANGUAGE_ID で
      // languageIds.typescript = "typescript" にルーティングされる。
      const ts = getFileIconUrl("foo.ts");
      const tsx = getFileIconUrl("foo.tsx");
      expect(ts).toBeTruthy();
      expect(tsx).toBeTruthy();
      expect(ts).not.toBe(tsx);
    });

    it(".py は languageIds 経由で解決され、デフォルトと異なる URL", () => {
      const py = getFileIconUrl("script.py");
      const def = getFileIconUrl("foo");
      expect(py).toBeTruthy();
      expect(py).not.toBe(def);
    });

    it("未知の拡張子はデフォルトファイルアイコンにフォールバック", () => {
      const unknown = getFileIconUrl("foo.xyzzyzzz");
      const noExt = getFileIconUrl("foo");
      expect(unknown).toBeTruthy();
      expect(unknown).toBe(noExt);
    });

    it("空文字列でもデフォルトを返す", () => {
      expect(getFileIconUrl("")).toBeTruthy();
    });

    it("大文字小文字を無視する (.TSX も .tsx と同じ URL)", () => {
      const upper = getFileIconUrl("App.TSX");
      const lower = getFileIconUrl("app.tsx");
      expect(upper).toBe(lower);
    });
  });

  describe("getFolderIconUrl", () => {
    it("既知のフォルダ名 (src) で URL を返す", () => {
      expect(getFolderIconUrl("src")).toBeTruthy();
    });

    it("既知のフォルダ名はデフォルトと異なる URL を返す", () => {
      const named = getFolderIconUrl("src");
      const fallback = getFolderIconUrl("__unknown_folder_xyz__");
      expect(named).toBeTruthy();
      expect(named).not.toBe(fallback);
    });

    it("node_modules 専用アイコンがあり、デフォルトとも src とも異なる", () => {
      const nm = getFolderIconUrl("node_modules");
      const src = getFolderIconUrl("src");
      const fallback = getFolderIconUrl("__unknown_folder_xyz__");
      expect(nm).toBeTruthy();
      expect(nm).not.toBe(fallback);
      expect(nm).not.toBe(src);
    });

    it("expanded フラグでも非 null を返す", () => {
      // テーマによっては collapse/expanded の URL が同一なので等価判定はしない
      expect(getFolderIconUrl("src", false)).toBeTruthy();
      expect(getFolderIconUrl("src", true)).toBeTruthy();
    });

    it("未知のフォルダ名はデフォルトフォルダアイコンにフォールバック", () => {
      const url = getFolderIconUrl("__some_unknown_folder_xyz__");
      const fallback = getFolderIconUrl("");
      expect(url).toBe(fallback);
    });
  });

  describe("manifest 構造の前提", () => {
    it("urlByBasename には複数の SVG が登録されている", () => {
      // テスト環境で import.meta.glob が SVG を実際に拾えていることの確認。
      // 1238 個全部とは限らないが、最低でも数百はあるはず。
      expect(__TEST__.urlByBasename.size).toBeGreaterThan(100);
    });

    it("manifest.file / manifest.folder のデフォルトが定義されている", () => {
      expect(__TEST__.manifest.file).toBeTruthy();
      expect(__TEST__.manifest.folder).toBeTruthy();
    });
  });
});
