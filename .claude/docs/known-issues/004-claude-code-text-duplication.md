# 004: Claude Code (Ink TUI) の長文が 3〜4 回重複表示される

**Status**: Fixed
**Discovered**: 2026-05-10
**Resolved**: 2026-05-10
**Related**: Known Issue [002](./002-scrollback-cols-mismatch.md)（同系統の resize スパム）

---

## Symptoms

Claude Code（Ink ベース TUI）で長いチャットを続けると、同じ文章ブロックが 3〜4 回連続でスクロールバックに残る。最初の出力は正常で、途中から「同じ段落が縦にスタック」する形で見える。

例: 表組み出力が同じ内容で 1 回目は罫線テーブル、2 回目以降はキー: 値リスト形式（Ink がターミナル幅変化を検知して再描画したため形が変わる）で再出力され、その後の長文段落は完全に同じ形のまま 3〜4 回繰り返される。

再現条件:

- Claude Code で長めの応答（30 行以上）を生成中
- その途中で何らかのレイアウト変化イベント（右サイドバーのドラッグ・開閉、Cmd+;/-/0 のアプリ全体ズーム、ウィンドウ resize、Settings ロード等）が起きる
- 各イベントの間隔が ~80ms より長い（=旧 debounce ウィンドウを跨ぐ）

Known Issue 002 で「scrollback 内の極狭幅 cols 不整合」を直したのと同根（resize 経路の取りこぼし）だが、今回は **PTY へ送る SIGWINCH の no-op 連発** が原因。

## Root Cause

3 つの欠陥の合算で再発した:

### 欠陥 A — schedulePtyResize に「最後に送ったサイズ」での dedup が無かった

`terminalManager.ts` の `schedulePtyResize` は 80ms トレーリング debounce で「短時間の連発」は集約していたが、debounce タイマーが時間切れになると **cols/rows が前回送信値と同じでも IPC を発射** していた。

これが致命的だった経路:

1. `SplitContainer.handlePanelResize` が `invalidateLastSize` を呼ぶ（兄弟ペイン操作・初回 measure・全画面切替で react-resizable-panels が「サイズ変化なし」でも onResize を発火する）
2. 続けて `fit()` が呼ばれる → 提案サイズは変わっていなくても `lastSizes` がクリアされているので IPC を schedule
3. 80ms 後に IPC 発射 → main 側 `pty.resize` → SIGWINCH
4. Ink が画面を「N 行戻って消して描き直す」を試みる
5. 長文で生きた領域がスクロールアウト済みだと「戻りすぎ / 戻りきれない」が起き、消去が空振り → **古いブロックが残ったまま新しい描画が下に追記される**

### 欠陥 B — debounce 80ms は短すぎた

ユーザーが「ドラッグ → 100ms 止まる → 再ドラッグ」したり、起動直後に `RightSidebar` の永続化値ロード 3 本が ~50〜200ms ずれて連続発火するパターンが、80ms ウィンドウを素通りして 3〜5 発の SIGWINCH を発射していた。

### 欠陥 C — RightSidebar.tsx の永続化ロードが 3 本独立した useEffect で走る

`RightSidebar.tsx` で `getWidth` / `getOpen` / `getFullscreen` が **3 本の useEffect で独立** に await → setState されており、each then() の resolve タイミングが ~10〜100ms ずれていた。これが起動直後にメインターミナル領域の幅を 3 連続で変動させ、各変動で ResizeObserver が発火 → fit() → SIGWINCH を 3 発打っていた。

## Fix

[`src/renderer/services/terminalManager.ts`](../../../src/renderer/services/terminalManager.ts)

- `lastSentSizes: Map<string, {cols, rows}>` を新規追加。`schedulePtyResize` の timer 発火時に「前回 PTY へ送ったサイズと完全一致」なら IPC を skip（欠陥 A）
- `PTY_RESIZE_DEBOUNCE_MS` を 80ms → **200ms** へ引き上げ（欠陥 B）
- `destroy(id)` で `lastSentSizes.delete(id)` も実行（同 id 再利用時の初回 IPC 抑止退行を防ぐ）
- テスト用 `clearLastSentSizes()` を export

[`src/renderer/components/RightSidebar/RightSidebar.tsx`](../../../src/renderer/components/RightSidebar/RightSidebar.tsx)

- 永続化値の取得 3 本（width / open / fullscreen）を `Promise.all` で 1 本に集約。`setState` を 1 フレーム内に固める（欠陥 C）
- `openInitialized` / `fullscreenInitialized` を `persistInitialized` に統合

[`src/renderer/services/__tests__/terminalManager.test.ts`](../../../src/renderer/services/__tests__/terminalManager.test.ts)

- 新規テスト: 「同サイズの fit() を 2 回呼んでも IPC は 1 回しか飛ばない」
- 新規テスト: 「destroy() 後の同 id 再生成では同サイズでも初回 IPC が飛ぶ」
- 既存 debounce テストの `advanceTimersByTime` を 100ms → 250ms へ追従更新

## Lessons Learned

- **debounce だけでは不十分**: 「短時間の連発を 1 発に集約する」と「同じ値の連続送信を抑止する」は別問題。両方ガードしないと TUI は再描画する
- **invalidate API は強力すぎる副作用を持つ**: `invalidateLastSize` のような「キャッシュ破壊」操作は、その後 fit() が同サイズでも必ず IPC を発射する経路を作る。invalidate ⇔ 実 IPC の間にもう 1 段「最後に送った値」での dedup を挟む
- **複数の非同期初期化は 1 本に束ねる**: 起動直後の useEffect が同種の永続化値を別々に取得すると、resolve タイミングのバラつきがレイアウト変動の連鎖を招く。`Promise.all` で同時に取って setState を集約する
- **TUI が SIGWINCH 1 発で再描画すること自体は正常動作**: 自分のアプリが no-op SIGWINCH を打たないことが防衛線。Ink / fzf / less などすべての TUI がこの条件を前提に作られている

## References

- 関連ファイル:
  - `src/renderer/services/terminalManager.ts:569-605` (PTY_RESIZE_DEBOUNCE_MS=200, lastSentSizes Map, dedup 実装)
  - `src/renderer/services/terminalManager.ts:489-495` (destroy で lastSentSizes をクリーンアップ)
  - `src/renderer/components/RightSidebar/RightSidebar.tsx:26-50` (永続化ロード Promise.all 集約)
  - `src/renderer/components/SplitContainer.tsx:34-48` (invalidate + fit を呼ぶ側、コメントに症状名あり)
- 関連 Known Issue: [002](./002-scrollback-cols-mismatch.md)（先行する resize 経路バグ・同じ修正系統）
- 関連コミット: `2c68760` (前回の不完全修正、80ms debounce のみ追加)
