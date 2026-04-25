# Session Persistence (T3-4)

- **Status**: COMPLETED
- **Created**: 2026-04-25
- **Task**: T3-4: セッション永続化（タブ / ペイン構成の復元）
- **Project path**: `/Users/newlife/dev/apps/terminal-division`
- **Related**: `.claude/docs/requirements/tier-3-experimental.md` §T3-4

---

## Context

### 動機

アプリ再起動時に前回のペイン分割構成と各ペインの CWD を復元したい。Dock の「最近のディレクトリ」では「分割構成」までは復元できないため、ビルド監視 + ログ tail + 対話シェルといった "作業セット" を毎回手動で組み直す必要がある。Tier 3 の評価で「実装軽量・ユーザー価値高い」と認定済み。

### 制約

- **PTY プロセスは永続化不可**: 各ペインで新規 PTY を生成し、保存されていた CWD で起動する
- **`MAX_TERMINALS = 6`**: 改ざん・破損ファイルから 7 ペイン以上が生えないよう、復元時に検証
- **multi-window は v1 スコープ外**: 最後に閉じたウィンドウのレイアウトを次回起動時に復元する単一レイアウト方式から開始
- **既存永続化パターンに従う**: `recent-directories.ts` / `sidebar-state.ts` と同じ singleton + 遅延書込 + サイレントフォールバックを踏襲

### Non-goals

- 実行中プロセスの復元（プロセス名、シェル状態、コマンド履歴）
- Window position / size の復元（OS / Electron 標準に委ねる）
- multi-window の同時復元
- 永続化のオプトアウト UI（必要になったら追加）
- アクティブペイン ID の復元（最初の葉ペインを active にする簡易方針）

### 設計判断（重要）

1. **保存粒度**: レイアウト全体を 1 オブジェクトでスナップショット保存。差分ではなく全置換。
2. **保存タイミング**: レイアウト変更（split / close）と CWD 変更（OSC 7）を契機に Renderer から IPC で Main に送信、Main 側で 250ms debounce してファイルに書く。
3. **復元タイミング**: Main が起動時にファイルを読み、`createWindow()` の前にメモリ保持。Renderer 起動後、既存の preload buffer 機構（`window:initialCwd` 同等）で 1 度だけ取り出し、`terminalStore.hydrateLayout()` で復元する。
4. **PTY 起動時の CWD**: Renderer の `terminalMetaStore` を復元時に先行ハイドレート → `TerminalPane` 初回マウントで `getInitialCwd()` 相当の解決時にメタストア優先順位をそのまま利用 → PTY が保存 CWD で起動。既存の優先順位（メタストア > windowInitialCwd > undefined）を変えない。
5. **スキーマバージョニング**: v1 から `version: 1` フィールドを持つ。読み込み時に version 不一致なら破棄して fresh 状態。
6. **検証ロジック**: ノード数 ≤ 6、`rootId` がノード集合に存在、parentId / children 参照の整合、サイクルなし、葉と分岐の型ガード合致。1 つでも違反すれば全体破棄。
7. **CWD の存在チェック**: 保存 CWD が起動時にもう存在しないとき → そのペインの cwd を `null` にして PTY デフォルト（HOME）で起動。レイアウト構造は維持する。
8. **空状態フォールバック**: 復元データなし / 破損 / 検証失敗 → 既存の単一ペイン初期化フローをそのまま使う（特別な分岐を増やさない）。

---

## Steps

各ステップは独立検証可能な単位。

### Phase 1: 永続化基盤（Main プロセス）

- [ ] **1.1**: 型定義 `SerializedLayout` を `src/main/types/session-state.ts` に新設（renderer 型と独立、IPC 境界専用の DTO）
- [ ] **1.2**: `src/main/session-state.ts` を新設。`SessionStateManager` クラスで load / save / clear、`recent-directories.ts` 同形のシングルトン。スキーマ検証（version、ノード数 ≤ 6、ツリー整合）を `validate(raw)` で実装
- [ ] **1.3**: `src/main/ipc-handlers.ts` に `session:save` (renderer → main) / `session:load` (main → 起動時のみ buffer 経由) / `session:clear` を追加。`session:save` は受信した payload を SessionStateManager.save() に流す（Main 側で 250ms debounce）
- [ ] **1.4**: `src/main/window-manager.ts` の `createWindow()` で、起動時のみ `SessionStateManager.load()` の結果を `window:restoreSession` IPC で送信。`initialCwd` フローを参考にバッファ → 1 回限り取り出し
- [ ] **1.5**: `src/preload/index.ts` に `window.api.session.save(payload)` / `window.api.session.getRestoreData()` / `window.api.session.clear()` を公開。`getRestoreData()` は preload の buffer を 1 度返して null クリア

### Phase 2: 復元フック（Renderer プロセス）

- [ ] **2.1**: `src/renderer/stores/terminalStore.ts` に `hydrateLayout(serialized: SerializedLayout)` action を追加。`nodes` Map / `rootId` / `terminalCount` を一括置換。最初の葉ペインを `activeTerminalId` に設定
- [ ] **2.2**: `src/renderer/stores/terminalMetaStore.ts` に `hydrateMetas(metas: Map<string, { cwd: string | null }>)` action を追加。既存 `initMeta` の上書き禁止ガードを尊重しつつ、復元時のみ既存メタを置換できるよう専用 action として分離
- [ ] **2.3**: `src/renderer/services/sessionRestore.ts` を新設。シリアライズ／デシリアライズ／検証関数（renderer 側でも防衛的に検証）を export。round-trip 単体テスト対象
- [ ] **2.4**: `src/renderer/App.tsx` の最初の `useEffect`（既存の初期 1 ペイン作成箇所）を分岐: 復元データありなら `hydrateLayout()` + `hydrateMetas()`、なしなら従来どおり 1 ペイン作成

### Phase 3: 保存トリガ（Renderer プロセス）

- [ ] **3.1**: `src/renderer/services/sessionPersist.ts` を新設。`terminalStore` / `terminalMetaStore` を購読し、変更があれば `serialize()` → `window.api.session.save(payload)`。renderer 側でも 200ms 程度の節約用 debounce（Main の debounce と二重になるが、IPC 回数自体を抑える）
- [ ] **3.2**: `App.tsx` で `sessionPersist.ts` の購読を `useEffect` で起動 / `useEffect` クリーンアップで購読解除

### Phase 4: テスト

- [ ] **4.1**: `src/renderer/services/__tests__/sessionRestore.test.ts` を新設。serialize / deserialize round-trip、検証 (各破損パターン: 空、version 不一致、ノード数 7、rootId 不存在、サイクル、parentId 不整合、不正な direction)
- [ ] **4.2**: `src/main/__tests__/session-state.test.ts` を新設。`SessionStateManager` の load / save / clear / 検証。`fs` をモックして JSON I/O のみ確認
- [ ] **4.3**: 既存の `terminalStore.test.ts` に `hydrateLayout` の単体テスト追加（正常系 + ノード数超過拒否）
- [ ] **4.4**: `terminalMetaStore.test.ts` に `hydrateMetas` の単体テスト追加

### Phase 5: 動作確認 + ドキュメント

- [ ] **5.1**: `npm run dev` で動作確認: 4 ペインに分割 → 各ペインで `cd` して別ディレクトリへ → 全終了 → 再起動 → 構成と CWD が復元されること
- [ ] **5.2**: 検証失敗の動作確認: `userData/session-state.json` を手で破損 → 起動時にサイレントフォールバック（単一ペイン）になること
- [ ] **5.3**: 存在しない CWD 復元の動作確認: 保存後にディレクトリ削除 → 起動時にそのペインだけ HOME に落ちること（他ペインは保存 CWD で起動）
- [ ] **5.4**: `.claude/CLAUDE.md` §3 (Architecture) に「セッション永続化」節を追加、§8 Tier 3 から T3-4 を昇格表記
- [ ] **5.5**: `.claude/docs/requirements/tier-3-experimental.md` から T3-4 を削除し `tier-2-supporting.md` に T2-7 として追加（Acceptance Criteria はすべて [x] で）

---

## Files

| File                                                      | Operation | Notes                                                                           |
| --------------------------------------------------------- | --------- | ------------------------------------------------------------------------------- |
| `src/main/types/session-state.ts`                         | New       | `SerializedLayout` / `SerializedNode` / `SerializedMeta` DTO                    |
| `src/main/session-state.ts`                               | New       | `SessionStateManager` クラス（singleton + debounced save + validation）         |
| `src/main/ipc-handlers.ts`                                | Edit      | `session:save` / `session:clear` ハンドラ追加                                   |
| `src/main/window-manager.ts`                              | Edit      | `createWindow()` で `SessionStateManager.load()` → `window:restoreSession` 送信 |
| `src/preload/index.ts`                                    | Edit      | `window.api.session.*` 公開、buffer + 1 回取り出しパターン                      |
| `src/renderer/stores/terminalStore.ts`                    | Edit      | `hydrateLayout()` action 追加                                                   |
| `src/renderer/stores/terminalMetaStore.ts`                | Edit      | `hydrateMetas()` action 追加                                                    |
| `src/renderer/services/sessionRestore.ts`                 | New       | serialize / deserialize / validate                                              |
| `src/renderer/services/sessionPersist.ts`                 | New       | store 購読 + IPC 送信（debounced）                                              |
| `src/renderer/App.tsx`                                    | Edit      | 起動時の復元分岐 + 購読開始                                                     |
| `src/renderer/services/__tests__/sessionRestore.test.ts`  | New       | round-trip + 検証ケース 7 種                                                    |
| `src/main/__tests__/session-state.test.ts`                | New       | I/O + validation のユニットテスト                                               |
| `src/renderer/stores/__tests__/terminalStore.test.ts`     | Edit      | `hydrateLayout` テスト追加                                                      |
| `src/renderer/stores/__tests__/terminalMetaStore.test.ts` | Edit      | `hydrateMetas` テスト追加（既存テスト存在しなければ新設）                       |
| `.claude/CLAUDE.md`                                       | Edit      | §3 にセッション永続化節追加、Tier Map 更新                                      |
| `.claude/docs/requirements/tier-2-supporting.md`          | Edit      | T2-7 として追加                                                                 |
| `.claude/docs/requirements/tier-3-experimental.md`        | Edit      | T3-4 を削除                                                                     |

---

## Verification

- [ ] `npm test` 全グリーン（既存 198 件 + 新規 ≥15 件）
- [ ] `npm run build` プロダクションビルド成功
- [ ] `npm run dev` で 4 ペイン分割 + 各ペイン異なる CWD → 終了 → 再起動 → 構成と CWD 完全復元
- [ ] `userData/session-state.json` を破損させて起動 → クラッシュせず単一ペイン起動
- [ ] 保存 CWD のディレクトリを削除して起動 → 該当ペインのみ HOME 起動、他は保存 CWD
- [ ] レイアウト変更 / `cd` から 250ms 以内に `session-state.json` のタイムスタンプが更新される
- [ ] `MAX_TERMINALS=6` 制約: `nodes` 数 7 を含む手書き JSON で起動 → 全体破棄して単一ペイン
- [ ] スキーマ version 不一致（`version: 999`）の手書き JSON で起動 → 全体破棄して単一ペイン
- [ ] アプリ強制終了（Cmd+Q なしの kill -9）でも、直前の save 内容は復元される（debounce 250ms 経過後の終了で確認）

---

## 実装順序メモ

Phase 1（基盤） → Phase 2（復元） → Phase 5.1（empty session で動作確認）→ Phase 3（保存）→ Phase 5.1（保存→復元の往復）→ Phase 4（テスト整備）→ Phase 5.2-5.5（破損ケース確認 + ドキュメント）

復元を先に通せる状態にしてから保存をつなぐ。これにより「保存はできるが復元時にバグ」を最後まで気付けないリスクを避ける。
