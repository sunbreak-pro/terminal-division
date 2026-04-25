# Plan: Follow-up Improvements (起動ログ補強 / 可用性通知 / リファクタ)

**Status**: COMPLETED
**Created**: 2026-04-25
**Completed**: 2026-04-25
**Task**: PTY 起動ログ問題の追加検証・可用性通知・コード整理（[MEMORY.md](./MEMORY.md) 参照）
**Project**: /Users/newlife/dev/apps/terminal-division

## Context

### 動機

2026-04-25 のコミット `1bef705` で次の修正を実施済み:

- A-1: PTY 出力の per-id バッファ + `pty:flushInitialBuffer` による起動ログ取りこぼし対策
- A-3: `splitTerminal` の `initMeta` 必須化
- B-R1: PTY spawn 失敗の toast 通知
- B-S1: fs IPC 全境界のパス allow-list
- 小規模: openExternal URL parse / openInVSCode の shell:false / node-pty env deny-list / CSP / chokidar windowIds 掃除

監査で挙げた中規模・大規模タスクのうち、未着手のものを本計画書で消化する。テーマは 3 系統:

1. **起動ログ問題の補強**（A-2 / A-5）— A-1 で本命の競合は解消したが、StrictMode 二重マウント時の DOM 整合性と `setTimeout(0)` 依存は構造的脆弱性として残っている
2. **可用性通知**（B-R2 / B-R3 / B-R5）— silent failure を可視化（session save 失敗 / chokidar error / multi-window restore 競合）
3. **コード整理**（B-Q2 / B-B2 / B-Q1）— 二元管理・非アトミック更新・validation 二重実装の解消

### 制約

- 既存テスト 251 件 + ビルドのグリーンを維持
- IPC チャネル名は `domain:action` 規約厳守
- xterm 直接書き込みは `terminalManager` 経由（Known Issue 002）
- バックワード互換: `session-state.json` の version は据え置き（v1）。SSOT 化はパース層の統合のみで DTO は不変

### Non-Goals

- セッション永続化のスキーマ変更（プロセス情報・ウィンドウサイズ復元など）
- multi-window 完全対応（B-R5 はあくまで「最初の 1 ウィンドウのみ復元」の堅牢化）
- パッケージ版固有問題（PATH 解決等）への着手は別計画
- xterm のリアクティブ DOM 管理リファクタ（StrictMode 整合の最小修正に留める）

## Steps

各ステップは独立してマージ可能。原則「上から順に着手」だが、依存のないステップは並行も可。

### Step 1: A-2 — StrictMode 下での xterm DOM 整合性検証と修正

**目的**: A-1 で起動ログ問題が解消されたかを実機で再現確認し、残留があれば DOM attach 経路を補強。

- [ ] 実機で「6 ペインまで分割 → 全ペインで起動ログが表示される」ことを確認（dev / packaged 両方）
- [ ] 残留がある場合のみ `terminalManager.attachToContainer` の以下を補強:
  - `terminalElement.parentElement === container` 判定で StrictMode の再マウント container 同一性を検証するログを一時追加
  - 必要なら「element が container の子ではないが parentElement に何か別の要素が居る」異常系を fail-safe で `terminal.open()` 再実行へ倒す
- [ ] `terminalManager.test.ts` に「同一 id の getOrCreate が二度呼ばれても callback の重複登録が起きない」の確認テストを追加（既存設計の固定化）

### Step 2: A-5 — `setTimeout(0)` 排除と `useLayoutEffect` 化

**目的**: `TerminalPane.tsx` の effect 内 `setTimeout(0)` で attach → fit → pty:create の順序を確保している fragile 設計を、React の `useLayoutEffect` で順序明示に置き換える。

- [ ] `useEffect` → `useLayoutEffect` に変更（DOM 反映後・paint 前に同期実行されるため fit が安定）
- [ ] `setTimeout(0)` の呼び出しを削除し、`attachToContainer` 直後に `fitAddon.fit()` → `pty.create()` を同期で発火
- [ ] `pty.create` の Promise resolve は非同期のまま（IPC のため）。`then` 内の `flushInitialBuffer` / `resize` 順序は維持
- [ ] StrictMode 二重実行で同期 fit が二度走ることになるが、`fit()` は冪等なので安全。テストで確認
- [ ] `TerminalPane.test.tsx` の `vi.runAllTimers()` 依存を見直し、`useLayoutEffect` ベースの assertion へ更新

### Step 3: B-R2 — session save 失敗の toast 通知

**目的**: disk full / 権限エラーで `session-state.json` が書けなかった場合、ユーザに気づかせる。

- [ ] `src/main/session-state.ts` の `save()` で catch ブロックに `BrowserWindow.getAllWindows()` 経由で `session:saveFailed` イベントを送信
- [ ] `src/preload/index.ts` の `window.api.session` に `onSaveFailed: createIpcListener<{ message: string }>(...)` を追加
- [ ] `src/renderer/services/sessionPersist.ts`（または `App.tsx` の `useEffect`）で `onSaveFailed` を購読し `showErrorToast(...)` を呼ぶ
- [ ] 連投を防ぐ: 同一エラーメッセージは 30 秒以内に再通知しない（renderer 側で last-shown 時刻を保持）
- [ ] `session-state.test.ts` に「writeFile が throw した場合に通知が走る」ケースを追加（mock fs でエラー注入）

### Step 4: B-R3 — chokidar error の閾値通知

**目的**: `file-system-handler.ts:100` の `console.warn` 握り潰しを置き換え、watcher が継続的に失敗したらユーザに通知。

- [ ] `WatchEntry` に `errorCount: number` / `firstErrorAt: number` を追加
- [ ] `watcher.on("error")` で count++、5 分間で 5 件超なら `BrowserWindow.fromId(...).webContents.send("fs:watcherError", { dirPath, message })` を一度だけ送信し count をリセット
- [ ] `preload/index.ts` の `fs` に `onWatcherError: createIpcListener<{ dirPath: string; message: string }>(...)` を追加
- [ ] renderer 側の購読は `Sidebar.tsx` または専用 hook で行い、「ファイル監視が失敗しています: <dirPath>」という toast を 1 回表示
- [ ] テスト: `file-system-handler` 単体テストは現在無い。`chokidar` のモックが重いので、新規追加は本計画ではスキップし、Step 8 で Vitest mock を整備するときにまとめて入れる

### Step 5: B-R5 — multi-window restore 競合の堅牢化

**目的**: `sessionRestoreConsumed` フラグは存在するが、Dock 経由の追加ウィンドウと「最初の getRestoreData 呼び出し」の race を構造的に保護する。

- [ ] `src/main/ipc-handlers.ts:setupIpcHandlers` 内のクロージャで管理している `sessionRestoreConsumed` を `sessionStateManager` のメソッドへ移動（`consumeRestoreData(): SerializedLayout | null`）
- [ ] 同 method を mutex 化（同期で `consumed` チェック → 即フラグ立て → return）
- [ ] Dock 経由の追加ウィンドウは `window-manager.ts:createWindow(initialCwd)` で `initialCwd` 優先、`session:getRestoreData` を呼ばないことを ensure（現状の設計確認）
- [ ] テスト: `session-state.test.ts` に「`consumeRestoreData` が連続呼び出しで 2 回目以降 null を返す」ケースを追加
- [ ] 既存の動作互換: renderer 側 `bootstrap()` の挙動は変えない

### Step 6: B-Q2 — `promptDotStates` を `TerminalInstance` に統合（純リファクタ）

**目的**: `terminalManager.ts:108` の module-scope `promptDotStates: Map<string, PromptDotState>` を `TerminalInstance` に吸収し、registry との二元管理を解消。

- [ ] `TerminalInstance` interface に `promptDot: PromptDotState` を追加（初期値 `{ marker: null, decoration: null }`）
- [ ] OSC 7770 ハンドラ内の `promptDotStates.get(id) / .set(id, ...)` を `instance.promptDot` 参照に置換
- [ ] `destroy(id)` の cleanup を `instance.promptDot.decoration?.dispose()` / `instance.promptDot.marker?.dispose()` に統合
- [ ] `promptDotStates` Map を削除
- [ ] 既存テスト 32 件 (`terminalManager.test.ts`) がそのまま pass することを確認

### Step 7: B-B2 — Zustand 複数ストア更新の atomic 化

**目的**: `terminalStore.splitTerminal` 内で `terminalStore.set` と `terminalMetaStore.initMeta/setCwd` が連続呼び出しになる箇所の中間状態観測リスクを解消。

- [ ] 設計選択: Zustand のトランザクション機構は薄いので、「両ストアを更新する単一 action」パターンを採用
  - `useTerminalActions` を hook ではなく `terminalActions.ts` モジュールとして再設計し、`splitTerminalWithMeta(id, direction)` のような combined action を export
  - 内部で `terminalStore.set()` を 1 回、`metaStore.set()` を 1 回呼ぶよう調整（個別 action `initMeta`/`setCwd` ではなく、低レベル `set` を使う）
- [ ] 移行を最小化するため、既存の `splitTerminal` シグネチャは温存し、内部実装だけを差し替える
- [ ] `terminalStore.test.ts` の既存 21 件と新規 1 件「split 後にサブスクライバが中間状態を観測しない」を追加（subscribe で 1 回だけ通知が来ることを確認）

### Step 8: B-Q1 — session-state validation の SSOT 化（大規模）

**目的**: `src/main/session-state.ts:86-185` の検証ロジックと `src/renderer/services/sessionRestore.ts:78-118` の防衛検証を 1 箇所に統合。

- [ ] `src/shared/session-state-validator.ts` を新設（または既存 `src/main/types/session-state.ts` を拡張して検証関数も export）
- [ ] `electron.vite.config.ts` で `@shared` エイリアスを main / preload / renderer すべてに登録
- [ ] Main 側の `validateSerializedLayout` / `validateSerializedSession` を shared へ移動
- [ ] Renderer 側 `deserializeLayout` から重複ロジックを削除し shared 関数を call
- [ ] `session-state.test.ts` を `shared/__tests__/session-state-validator.test.ts` に移行（13 件）
- [ ] バージョン定数 `SESSION_STATE_VERSION` も shared に移し、main / renderer / preload のすべてが同じ const を参照する形に
- [ ] 互換: `session-state.json` のオンディスク形式は不変、コード移動のみ

## Files

| File                                                      | Operation | Notes                                                                                      |
| --------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `src/renderer/services/terminalManager.ts`                | Modify    | Step 1 / Step 6（`attachToContainer` 補強・`promptDotStates` 統合）                        |
| `src/renderer/components/TerminalPane.tsx`                | Modify    | Step 2（`useLayoutEffect` 化、`setTimeout(0)` 排除）                                       |
| `src/renderer/components/__tests__/TerminalPane.test.tsx` | Modify    | Step 2（fake timers 依存の解消）                                                           |
| `src/main/session-state.ts`                               | Modify    | Step 3 / Step 5 / Step 8（save 失敗通知、`consumeRestoreData` API、検証ロジック移動）      |
| `src/main/__tests__/session-state.test.ts`                | Modify    | Step 3 / Step 5 / Step 8（writeFile fail 通知 / consumeRestoreData / shared 検証への移行） |
| `src/main/ipc-handlers.ts`                                | Modify    | Step 5（`sessionRestoreConsumed` クロージャの整理）                                        |
| `src/main/file-system-handler.ts`                         | Modify    | Step 4（chokidar `error` の閾値カウント + 通知送信）                                       |
| `src/preload/index.ts`                                    | Modify    | Step 3 / Step 4（`session.onSaveFailed` / `fs.onWatcherError`）                            |
| `src/renderer/services/sessionPersist.ts`                 | Modify    | Step 3（`onSaveFailed` 購読 + dedupe）                                                     |
| `src/renderer/components/Sidebar/Sidebar.tsx`             | Modify    | Step 4（`fs:watcherError` 購読）                                                           |
| `src/renderer/stores/terminalStore.ts`                    | Modify    | Step 7（combined action 内部実装の差し替え）                                               |
| `src/renderer/stores/__tests__/terminalStore.test.ts`     | Modify    | Step 7（中間状態観測テスト追加）                                                           |
| `src/shared/session-state-validator.ts`                   | Create    | Step 8（main/renderer 共通の検証）                                                         |
| `src/shared/__tests__/session-state-validator.test.ts`    | Create    | Step 8（既存 13 件の移行先）                                                               |
| `electron.vite.config.ts`                                 | Modify    | Step 8（`@shared` パスエイリアス追加）                                                     |
| `src/main/types/session-state.ts`                         | Modify    | Step 8（型定義は維持、検証関数は shared へ移動）                                           |
| `src/renderer/services/sessionRestore.ts`                 | Modify    | Step 8（防衛検証ロジックを shared 呼び出しに置換）                                         |
| `src/renderer/test/setup.ts`                              | Modify    | Step 3 / Step 4（新 IPC リスナーのモック追加）                                             |

## Verification

各 Step 完了時:

- [ ] `npm run build` が成功する（main / preload / renderer すべて）
- [ ] `npm test -- --run` が全件 pass
- [ ] 変更ファイルに対応する console.log 残存なし、any / 型アサーション過剰なし

リリース判定（全ステップ完了時）:

- [ ] **A-2/A-5**: 6 ペイン分割 → 全ペインで起動ログが見える / `setTimeout(0)` の grep ヒット 0
- [ ] **B-R2**: session-state.json の権限を 444 にして再起動 → toast 表示を確認
- [ ] **B-R3**: chokidar が watch しているディレクトリを連続して削除/作成（>5/5min）→ toast 表示を確認
- [ ] **B-R5**: Dock メニューから連続 2 ウィンドウ起動 → 1 つ目だけがレイアウト復元、2 つ目は単一ペイン + Dock 指定 CWD で起動
- [ ] **B-Q2/B-B2/B-Q1**: 機能挙動の変化なし、テスト全件 pass
- [ ] テスト合計 251 → 260 件超に増加（各 Step で +1〜+2 件）

## Out of Scope（本計画の対象外、将来計画として記録）

- パッケージ版固有の PATH / native module / LSEnvironment 問題（Known Issue 001 系）
- セッション永続化のスキーマ拡張（コマンド履歴・ウィンドウサイズ）
- xterm の React リアクティブ管理化（Strict Mode 完全対応はリファクタ規模が大きすぎる）
- OSC 133 シェル統合（Tier 3-3）
