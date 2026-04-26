# Clear Scrollback Options (T2-1 派生)

- **Status**: COMPLETED
- **Created**: 2026-04-26
- **Task**: スクロールバッククリアの「どれだけ消すか」をユーザーが選択できるようにする
- **Project path**: `/Users/newlife/dev/apps/terminal-division`
- **Related**: `.claude/docs/requirements/tier-2-supporting.md` §T2-1 / `src/renderer/components/TerminalSubHeader.tsx:164-170,391-415`

---

## Context

### 動機

現在、ペインヘッダーのゴミ箱アイコンは押すと即座に `terminal.clear()` を呼びスクロールバック全消去になる。実運用では「直近の 100 行は残したい」「ビルドログだけ消して履歴は保ちたい」というケースがあり、全消去か放置かの 2 択しかないのが不便。削除量を 1 アクションで選べるようにする。

### 制約

- **xterm.js の制限**: バッファ中の任意行範囲を直接削除する API は無い。実用的な手段は次のいずれか:
  - (a) `terminal.options.scrollback = N` で max を絞ると、xterm.js 内部の `BufferService` が古い行から trim する（v5 系で確認済の挙動）
  - (b) `terminal.buffer.active.getLine(i).translateToString(true)` で本文だけ取り出して clear → 書き戻し（ANSI スタイル / 色情報は欠落）
  - 本計画では (a) を採用。色情報を保持できるため。
- **PTY / シェル状態には触らない**: 現状の `clearScrollback` と同じく、実行中コマンドや履歴は維持する。
- **既存ショートカットを壊さない**: 現状はショートカット未割当。本計画でも追加しない（メニュー操作のみ）。
- **アイコン枠は 20×20**: アイコン分割（caret 追加）は採らない。クリックでポップオーバーを出す。

### Non-goals

- 「N 行残す」のカスタム数値入力 UI（プリセットのみで開始、必要になったら追加）
- 「最後のコマンド出力だけ消す」など OSC 133 / シェル統合に依存するセマンティック削除（T3-3 後送り）
- 全ペイン一括クリア
- スクロールバック全体上限（現状 10000）の変更
- メニュー選択履歴の永続化（毎回プリセット一覧から選び直す）

### 設計判断

1. **API は `terminalManager` に集約**: 既存 `clearScrollback(id)` を残しつつ、`trimScrollback(id, keepLines)` を新規追加。`terminal.reset()` を呼ぶ `resetTerminal(id)` も同時追加（メニュー末尾の「完全リセット」用）。
2. **trim 後に scrollback 上限を元に戻す**: `terminal.options.scrollback = keepLines` で trim させた直後、`microtask` 1 つ挟んで元の値（10000）に戻すことで、今後の出力が再び 10000 行まで蓄積できるようにする。trim 自体は同期で完了するため挙動は安定。
3. **メニュー UI は既存 `ContextMenu` を流用**: `Sidebar/ContextMenu.tsx` を `components/` 直下に移すか、参照場所を共通化する形でリファクタする。今回は **`Sidebar/` の場所はそのままに、TerminalSubHeader から相対 import で参照する**（ファイル移動は別 PR の責務に分離）。
4. **メニュー位置**: `getBoundingClientRect()` でアイコンの座標を取得し、その左下に開く。`ContextMenu` のはみ出し補正で右端ペインでも収まる。
5. **プリセットの値**: 100 / 500 / 1000 の 3 段階。現状の scrollback 上限 10000 に対し 1 / 5 / 10% の刻み。scrollback が既にプリセット以下なら no-op（メニュー項目は disabled にせず単に何もしない）。
6. **「完全リセット」は危険操作扱い**: `ContextMenu` の `danger` フラグで赤系色。区切り線で隔離。`terminal.reset()` はカーソル形状・モード・代替バッファを全リセットするためカーソルが消える等の副作用が起きうるが、テクスチャ崩れ復旧手段として残す価値がある。
7. **アクセシビリティ**: ボタンに `aria-haspopup="menu"` / `aria-expanded` を付与。メニューはすでに `role="menu"`。

---

## Steps

各ステップは独立検証可能な単位。

### Phase 1: terminalManager API 拡張

- [ ] **1.1**: `src/renderer/services/terminalManager.ts` に `trimScrollback(id: string, keepLines: number): void` を追加。`terminal.options.scrollback` を `keepLines` に下げて trim を発火 → `queueMicrotask(() => instance.terminal.options.scrollback = original)` で復帰。`keepLines >= original` なら no-op。`keepLines < 0` も no-op。
- [ ] **1.2**: `resetTerminal(id: string): void` を追加。`terminal.reset()` + `terminal.clearTextureAtlas()`。コメントで「PTY 状態には触らないが、xterm 側のモード状態（カーソル / 代替バッファ等）が完全に初期化される」旨を明記。
- [ ] **1.3**: 既存 `clearScrollback` の JSDoc に「全消去版。部分消去は trimScrollback を使う」旨を追記。

### Phase 2: メニュー UI

- [ ] **2.1**: `src/renderer/components/TerminalSubHeader.tsx` 内に menu open/close の `useState<{ x: number; y: number } | null>` を追加。`handleClearScrollback` を「クリック座標からポップオーバーを開く」処理に差し替える（`e.currentTarget.getBoundingClientRect()` の `left` / `bottom` を使用）。
- [ ] **2.2**: メニュー項目を `useMemo<ContextMenuItem[]>` で組み立て:
  - すべてクリア（プロンプト行は残す） → `terminalManager.clearScrollback(id)`
  - 直近 100 行を残す → `terminalManager.trimScrollback(id, 100)`
  - 直近 500 行を残す → `terminalManager.trimScrollback(id, 500)`
  - 直近 1000 行を残す → `terminalManager.trimScrollback(id, 1000)`
  - (separator) 完全リセット → `terminalManager.resetTerminal(id)`（`danger: true`）
- [ ] **2.3**: `ContextMenu` を `Sidebar/ContextMenu` から import し、open 時のみレンダ。`onClose` で `setMenu(null)`。
- [ ] **2.4**: ボタンに `aria-haspopup="menu"` と `aria-expanded={menu !== null}` を付与。`title` は「スクロールバックを削除（クリックでオプション表示）」に更新。

### Phase 3: テスト

- [ ] **3.1**: `src/renderer/services/__tests__/terminalManager.test.ts` に `trimScrollback` のテストを追加。
  - keepLines が現在の上限より小さい時、`terminal.options.scrollback` のセッターが `keepLines` で 1 度呼ばれ、microtask 後に元値で再セットされる
  - keepLines が現在上限以上 / 負数 / 0 の時、no-op
  - 存在しない id は no-op
- [ ] **3.2**: 同テストファイルに `resetTerminal` のテスト追加。`terminal.reset()` と `clearTextureAtlas()` がそれぞれ 1 回呼ばれる。存在しない id は no-op。
- [ ] **3.3**: `src/renderer/components/__tests__/` に `TerminalSubHeader.test.tsx` を新設（既存テストが無いため）または最小ケースのみ追加:
  - クリックでメニュー DOM が出現する
  - 「直近 100 行を残す」をクリックすると `trimScrollback(id, 100)` が呼ばれる
  - Escape でメニューが閉じる

  （component 単体テストの新規追加コストが大きければ Phase 3.3 はスキップして Phase 4 の手動確認に寄せる）

### Phase 4: 動作確認

- [ ] **4.1**: `npm run dev` 起動。`yes | head -2000` 等で 2000 行以上出力 → ヘッダーのゴミ箱クリック → メニュー表示確認。
- [ ] **4.2**: 「すべてクリア」を実行 → 現状と同じくプロンプト行のみ残ることを確認。
- [ ] **4.3**: 再度大量出力 → 「直近 100 行を残す」→ スクロールバックが 100 行まで縮むことを確認（マウスホイール上スクロールで 100 行で止まる）。
- [ ] **4.4**: 「完全リセット」→ カーソルが初期状態に戻ること、PTY セッションは生きていてコマンド入力できることを確認。
- [ ] **4.5**: メニュー外クリック / Esc / 別ペインへフォーカス移動でメニューが閉じることを確認。
- [ ] **4.6**: 右端ペインでクリックしてもメニューが画面外にはみ出さないこと。

### Phase 5: ドキュメント更新

- [ ] **5.1**: `.claude/CLAUDE.md` §3 または §6 のいずれかに「スクロールバック操作は terminalManager 経由（trim / reset 含む）」と 1 行追記（既存 §6.3 のリスト末尾を想定）。
- [ ] **5.2**: `.claude/docs/requirements/tier-2-supporting.md` の T2-1 セクションにヘッダーのゴミ箱メニューの仕様を追記。
- [ ] **5.3**: 本ファイルの Status を `COMPLETED` に更新し `archive/` へ移動、`MEMORY.md` / `HISTORY.md` を task-tracker 経由で更新。

---

## Files

| File                                                           | Operation      | Notes                                                                    |
| -------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------ |
| `src/renderer/services/terminalManager.ts`                     | Edit           | `trimScrollback` / `resetTerminal` 追加、`clearScrollback` に JSDoc 追記 |
| `src/renderer/components/TerminalSubHeader.tsx`                | Edit           | menu state 追加、ハンドラ差し替え、`ContextMenu` レンダ、aria 属性追加   |
| `src/renderer/components/Sidebar/ContextMenu.tsx`              | Read-only      | import 元として再利用（変更なし）                                        |
| `src/renderer/services/__tests__/terminalManager.test.ts`      | Edit           | `trimScrollback` / `resetTerminal` テスト追加                            |
| `src/renderer/components/__tests__/TerminalSubHeader.test.tsx` | Create (任意)  | メニュー開閉と項目クリックの最小テスト                                   |
| `.claude/CLAUDE.md`                                            | Edit           | §6.3 にスクロールバック操作経路を 1 行追記                               |
| `.claude/docs/requirements/tier-2-supporting.md`               | Edit           | T2-1 にメニュー仕様を追記                                                |
| `.claude/2026-04-26-clear-scrollback-options.md`               | Move → archive | 完了時                                                                   |

---

## Verification

- [ ] `npm test` 全パス
- [ ] `npm run build` 成功
- [ ] 手動: 案 A の Phase 4.1〜4.6 を全て確認
- [ ] 手動: ペイン分割（2〜4 個）でも各ペインのメニューが独立して動くこと
- [ ] 手動: メニュー操作中に IME 入力 / ショートカットが暴発しないこと（capture phase で先取りされていないか）
- [ ] 視覚: ライト / ダーク両テーマでメニューが見やすい配色か
- [ ] アクセシビリティ: VoiceOver でボタンに「メニュー、折りたたみ」と読み上げられること
- [ ] 既存の `clearScrollback` 呼び出し箇所（あれば）に regression が無いこと（grep で 1 箇所のみ → 影響範囲は限定）

---

## Open Questions

- `trimScrollback` の trim が microtask 内で実際に発火するかは xterm.js 5.5.x の `BufferService._setMaxLines` 挙動依存。Phase 1.1 実装直後に手動で `terminal.buffer.active.length` を console.log して確認する。trim が遅延する場合は `setTimeout(0)` への切替で対応。
- 「直近 100 行を残す」を選んだ後、ユーザーが scrollback 上限自体を恒久的に下げたい欲求を持つ可能性があるが、設定 UI は今回スコープ外（別タスク）。
