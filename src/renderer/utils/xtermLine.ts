// xterm.js の `IBufferLine` から「文字列 offset → 1-based セル列」のマップを
// 構築するためのユーティリティ。
//
// 背景:
// - `IBufferLine.translateToString()` が返す文字列の長さは "code unit 数" だが、
//   xterm の `ILink.range.x` は "セル列 (1-based)" を要求する。
// - 全角文字 (CJK / 絵文字) は 1 code unit でも 2 セルを占有するため、文字列
//   オフセットをそのまま列として渡すと装飾位置が左へずれる。
// - regex マッチの `m.start` / `m.end` (string offset) を、正確なセル列に変換
//   するための補助マップをここで作る。

/** 必要な `IBufferLine` の最小サブセット (テスト容易性のため structural 型) */
export interface XtermLineLike {
  readonly length: number;
  getCell(x: number): { getWidth(): number; getChars(): string } | undefined;
}

/**
 * 文字列 offset を 1-based セル列に変換するマップを返す。
 *
 * - `map[i]` = 文字列の i 番目 (code unit) の最初のセルの 1-based 列
 * - 全角文字の **継続セル (width=0)** はスキップする (xterm 上では 1 セル目だけ
 *   存在し、2 セル目はビジュアルに同じ文字を占有しているのみ)
 * - 末尾に 1 要素の終端マーカー (最後の文字の次の列) を含める
 *
 * 範囲外参照に対しては `undefined` を返さず終端マーカー以降は `map[map.length-1]`
 * を読めるようになっている (caller 側で `?? fallback` を入れる前提)。
 */
export function buildOffsetToColumnMap(line: XtermLineLike): number[] {
  const map: number[] = [];
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell) continue;
    // 継続セル (全角文字の 2 セル目) は文字列上に存在しないので飛ばす
    if (cell.getWidth() === 0) continue;
    // 空セルは ' ' 1 文字として translateToString に現れるため、最低 1 entry は積む
    const chars = cell.getChars() || " ";
    for (let i = 0; i < chars.length; i++) {
      map.push(x + 1);
    }
  }
  // 終端マーカー (最後の文字の次のセル列)
  map.push((map[map.length - 1] ?? 0) + 1);
  return map;
}
