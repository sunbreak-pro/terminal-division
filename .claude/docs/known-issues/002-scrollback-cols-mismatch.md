# 002: Scrollback の cols 不整合（過去行が極狭幅で固定表示）

**Status**: Fixed
**Discovered**: 2026-04-27
**Resolved**: 2026-04-27
**Related**: `.claude/2026-04-27-pty-resize-sync.md`

---

## Symptoms

長時間 Claude Code (CLI) などの TUI を流したセッションで、scrollback 内の過去行が**左端に 1〜2 文字ずつ縦に並ぶ**異常表示になる。具体的には `Th / il / e' / Al / de / es / Al` の断片や、孤立した `8` のみが見え、右側は完全な空白。bullet (●/○/✓) の位置だけは正しい。再現条件:

- ペインの幅が起動直後 / split 直後 / md→cli 切替直後に**極端に狭い瞬間**がある
- その瞬間に Claude Code 等の TUI が `\r` + `\x1b[K` でストリーミング描画を流す
- 後でペイン幅を広げても、当時の幅で wrap された行が scrollback に残る

## Root Cause

xterm.js v5 は `terminal.resize(cols, rows)` を呼べば scrollback 含めて自動 reflow する（PR xtermjs/xterm.js#1864 以降の標準動作）。**バグは「resize() が呼ばれない / 古い cols で呼ばれる」状態を引き起こす経路が複数あったこと**。

| #   | 経路                                                                                                                    | 旧コード位置                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A   | viewMode `md → cli` 復帰時に同期 fit が無く、ResizeObserver の遅延 (50ms) を待つ間に古い cols で書き込まれる            | `TerminalPane.tsx` の `useLayoutEffect` 依存が `[id, closeTerminal]` のみで `showMd` 変化で再走しない |
| B   | react-resizable-panels の split drag が xterm に通知されない                                                            | `SplitContainer.tsx` の `<Panel>` に `onResize` 未設定                                                |
| C   | `fit()` の lastSizes キャッシュが PTY 側の cols と無関係に効き、`md→cli` 復帰時に同サイズ判定で `pty.resize` を抑止する | `terminalManager.ts` の `lastSizes` Map に invalidate API が無かった                                  |
| D   | `fitAddon.fit()` 例外時 (offsetWidth=0 など) に再試行せず null 返却で終わる                                             | `terminalManager.ts:fit()` の `catch { return null }`                                                 |
| E   | ResizeObserver の rafDebounce が 50ms 遅延で、その間 1 frame 分のテキストが旧 cols で記録される                         | `TerminalPane.tsx` の `rafDebounceWithDelay(handleFit, 50)`                                           |

## Fix

`.claude/2026-04-27-pty-resize-sync.md` に基づき、5 経路すべてに対応:

- **経路 A**: `TerminalPane.tsx` に `showMd` 遷移を観察する `useLayoutEffect` を追加。`md→cli` 復帰時に `terminalManager.invalidateLastSize(id)` → `handleFit()` を同期実行。
- **経路 B**: `SplitContainer.tsx` の `<Panel>` に `onResize` を設定し、葉ペインだけ `terminalManager.fit` + `pty.resize` を即時呼び出し。
- **経路 C**: `terminalManager.ts` に `invalidateLastSize(id: string): void` を新規 export。lastSizes キャッシュを破棄して次の fit() で必ず最新サイズを返すようにした。
- **経路 D**: `fit()` 内で `cols/rows` が 0/NaN なら 1 度だけ `requestAnimationFrame` でリトライし、成功したら直接 `window.api.pty.resize` を送る。
- **経路 E**: ResizeObserver 経路の `rafDebounceWithDelay(handleFit, 50)` を `delay=0` に変更。Panel.onResize と viewMode 同期 fit が主経路で、observer はフォールバックに格下げ。

修正ファイル:

- `src/renderer/components/TerminalPane.tsx`
- `src/renderer/services/terminalManager.ts`
- `src/renderer/components/SplitContainer.tsx`

テスト追加:

- `terminalManager.test.ts`: `invalidateLastSize` / fit() 0-cols ガード / rAF リトライ
- `TerminalPane.test.tsx`: md→cli 遷移で invalidate + fit + pty.resize が呼ばれること
- `SplitContainer.test.tsx`: Panel.onResize 経由で葉ペインの fit + pty.resize が呼ばれること

## Lessons Learned

- **xterm.js の scrollback は固定ではなく `resize()` で reflow される**。崩れていたら「resize が呼ばれていない」か「cols が誤っている」を疑う。
- **cols の到達保証が必要なすべての経路で fit + pty.resize がペアで動くことを確認する**。display:none → block / split drag / sessionRestore / window resize の各エッジに対応が要る。
- **lastSizes のような IPC 抑止キャッシュは「PTY が知っているサイズ」と独立した存在になり得る**。ライフサイクル境界（viewMode 切替、split 直後）で invalidate する手段を必ず用意する。
- **`fitAddon.fit()` は DOM サイズ未確定時に例外 / 0-cols を返す**。サイレント失敗は致命的なので少なくとも 1 回は rAF で再試行する。
- **react-resizable-panels v4.x の `Panel.onResize` はネイティブで使える**（`onResize?: (panelSize, id, prev) => void`）。ResizeObserver の遅延に頼らず最速で fit を呼べる。

## References

- 関連プラン: `.claude/2026-04-27-pty-resize-sync.md`
- xterm.js scrollback reflow: <https://github.com/xtermjs/xterm.js/pull/1864>
- react-resizable-panels Panel API: `node_modules/react-resizable-panels/dist/react-resizable-panels.d.ts:299`
- 関連ファイル:
  - `src/renderer/components/TerminalPane.tsx`
  - `src/renderer/services/terminalManager.ts:464-540`
  - `src/renderer/components/SplitContainer.tsx`
