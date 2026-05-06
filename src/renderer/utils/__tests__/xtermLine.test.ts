import { describe, it, expect } from "vitest";
import { buildOffsetToColumnMap, type XtermLineLike } from "../xtermLine";

// 簡易的な IBufferLine モック生成器。
// `cells` は各セルの { chars, width } を表す。継続セルは `{ chars: "", width: 0 }`。
function makeLine(
  cells: Array<{ chars: string; width: number }>,
): XtermLineLike {
  return {
    length: cells.length,
    getCell(x: number) {
      const c = cells[x];
      if (!c) return undefined;
      return {
        getWidth: () => c.width,
        getChars: () => c.chars,
      };
    },
  };
}

// 全角文字 (CJK / 絵文字) は xterm 上で「1 セル目に文字 + 2 セル目は継続セル」で表現される
function wideChar(ch: string): Array<{ chars: string; width: number }> {
  return [
    { chars: ch, width: 2 },
    { chars: "", width: 0 },
  ];
}

function asciiChar(ch: string): { chars: string; width: number } {
  return { chars: ch, width: 1 };
}

describe("buildOffsetToColumnMap", () => {
  it("ASCII のみの行では string offset と 1-based column が一致する", () => {
    // "/foo.md" → 7 セル
    const cells = "/foo.md".split("").map(asciiChar);
    const map = buildOffsetToColumnMap(makeLine(cells));
    expect(map.slice(0, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // 終端マーカー
    expect(map[7]).toBe(8);
  });

  it("全角文字が前にあると後続のセル列が右にずれる", () => {
    // "あ/foo.md" → セル: あ(2) /(1) f(1) o(1) o(1) .(1) m(1) d(1) = 9 セル
    // 文字列: "あ/foo.md" → 8 文字
    // string offset 0 = 'あ' → cell column 1 (1-based)
    // string offset 1 = '/' → cell column 3 (CJK が 2 セル占有後)
    // string offset 7 = 'd' → cell column 9
    const cells = [
      ...wideChar("あ"),
      ...["/", "f", "o", "o", ".", "m", "d"].map(asciiChar),
    ];
    const map = buildOffsetToColumnMap(makeLine(cells));
    expect(map[0]).toBe(1); // あ
    expect(map[1]).toBe(3); // /
    expect(map[2]).toBe(4); // f
    expect(map[7]).toBe(9); // d
    // 終端マーカー
    expect(map[8]).toBe(10);
  });

  it("複数の全角文字をまたぐと累積でずれる", () => {
    // "日本語/x.md" → 日(2) 本(2) 語(2) /(1) x(1) .(1) m(1) d(1) = 11 セル
    // string offset: 日=0 本=1 語=2 /=3 x=4 .=5 m=6 d=7 → 8 文字
    const cells = [
      ...wideChar("日"),
      ...wideChar("本"),
      ...wideChar("語"),
      ...["/", "x", ".", "m", "d"].map(asciiChar),
    ];
    const map = buildOffsetToColumnMap(makeLine(cells));
    expect(map[0]).toBe(1); // 日
    expect(map[1]).toBe(3); // 本
    expect(map[2]).toBe(5); // 語
    expect(map[3]).toBe(7); // /
    expect(map[7]).toBe(11); // d
  });

  it("全角文字が末尾にある場合も列幅を正しく加算する", () => {
    // "ab漢" → a(1) b(1) 漢(2) = 4 セル / 3 文字
    const cells = [...["a", "b"].map(asciiChar), ...wideChar("漢")];
    const map = buildOffsetToColumnMap(makeLine(cells));
    expect(map[0]).toBe(1);
    expect(map[1]).toBe(2);
    expect(map[2]).toBe(3); // 漢
    // 終端マーカーは 漢 の最初のセル列 + 1 = 4 (継続セルは push されないため)
    expect(map[3]).toBe(4);
  });

  it("空行では終端マーカーのみを返す", () => {
    const map = buildOffsetToColumnMap(makeLine([]));
    expect(map).toEqual([1]);
  });

  it("getCell が undefined を返すセルはスキップする", () => {
    const line: XtermLineLike = {
      length: 3,
      getCell: (x) => {
        if (x === 1) return undefined;
        return { getWidth: () => 1, getChars: () => "x" };
      },
    };
    const map = buildOffsetToColumnMap(line);
    // x=0 と x=2 のみ累積。string offset は x=1 をスキップしないが、
    // map に積まれる列は 1, 3 (x+1)
    expect(map[0]).toBe(1);
    expect(map[1]).toBe(3);
  });
});
