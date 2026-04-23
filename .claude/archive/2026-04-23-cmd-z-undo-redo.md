# Plan: Cmd+Z / Cmd+Shift+Z Undo/Redo 再実装

**Status**: COMPLETED（2026-04-23 実装完了、archive 格納）
**Created**: 2026-04-23
**Completed**: 2026-04-23

## 実装結果サマリ

### 採用した設計（ユーザー確認済み）

- Q1: 行スナップショット
- Q2: ALT screen（TUI）中は no-op
- Q3: OSC 133 非依存の簡易モデル
- Q4: Cmd+Backspace / Cmd+K / Option+Backspace / Option+D / Shift+Enter を `writeWithHistory` 経由に同じ PR で修正

### 変更ファイル

- `src/renderer/services/terminalManager.ts`: `InputHistoryState` / `applyHistoryDelta` / `pushHistoryState` / `isAltScreen` / `writeWithHistory` / `undo` / `redo` 追加（最大 100 履歴、Enter で履歴リセット、ALT screen ガード）
- `src/renderer/App.tsx`: Cmd+Z / Cmd+Shift+Z 追加、Cmd+Backspace / Cmd+K / Option+Backspace / Option+D / Shift+Enter を `terminalManager.writeWithHistory` 経由に変更
- `src/renderer/components/ShortcutsModal.tsx`: Line Editing カテゴリに `⌘ Z` / `⌘ ⇧ Z` 追加
- `src/renderer/services/__tests__/terminalManager.test.ts`: Undo/Redo 回帰テスト 10 件追加（全 123 テスト green）

### 省略した 3 層防御

旧実装の `undoRedoInProgress` / `pendingSentText` / 300ms タイマーは不採用。PTY エコーバックは `terminal.write` 経由で画面に反映されるのみで `terminal.onData` を発火しないため、エコーバックが履歴を汚染する経路は構造的に存在しない。もし将来 xterm.js の `terminal.write` で特定 escape sequence が `onData` を誘発する事例が見つかれば再評価。

### ドキュメント方針

ユーザー指示「Undo,Redo 関連のドキュメントや記述箇所は全て削除する」に従い、既存の Undo/Redo 関連ドキュメント（CLAUDE.md §3.5、coding-principles §4、tier-1-core.md T1-4、tier-2-supporting.md Cmd+Z 行、vision/core.md 3 項目、code-explanation/05-advanced-features.md の Undo/Redo 章、Known Issue 002、他）を全削除。新規ドキュメントは追加せず、コード自身とテスト、ShortcutsModal の UI 表示のみを一次情報とする。

---

## 元プラン（実装前の分析記録）

**Status（原文）**: DRAFT（設計分岐の合意待ち。§2 の Open Questions に回答をもらった後 IN_PROGRESS に昇格）
**Task**: MEMORY.md「入力行 Undo/Redo 再実装」
**Project**: `/Users/newlife/dev/apps/terminal-division`
**Related（原文）**:

- Known Issue 002 (cmd-backspace-undo-history) — 本実装と同一 PR で削除
- Coding Principles §4（旧） — 本実装と同一 PR で削除
- Requirements T1-4（旧） — 本実装と同一 PR で削除
- Commit `479341d` "Remove all history features..."（基盤削除の起点）

---

## 0. TL;DR

- T1-4 の Undo/Redo は **ドキュメント上は存在するが、コード上は 2026-02-20 に全削除されている**。
- Known Issue 002 の Fix（Cmd+Backspace の `terminalManager.clearLine()` 経由化）も同コミットで巻き戻り、**再発している**。
- 今回の再実装は「過去と同じ構造を戻す」ではなく、**過去失敗の根本原因を 3 つ潰す**ことを最優先する:
  1. シェル状態を App 側で推測する設計（Ctrl+W の単語削除を regex で真似る等）→ **シェル統合 OSC 133 が無いときは保守的に無効化**。
  2. PTY 直接書き込み経路が無秩序に増える → **`terminalManager` 経由の単一入口に統一**し、履歴を扱わない write は "raw write" として型レベルで区別する。
  3. 3 層エコーバック防御の複雑さ → **"送信直後は次の N 文字分を 1 回だけ無視"** の単一ガードに簡素化（必要なら時間窓は補助のみ）。

---

## 1. Context / Motivation

### 1.1 ユーザーからの要求

> `cmd+z,cmd+shift+z で Undo,Redo 機能をいよいよ作成したい。今まで標準として搭載されておらず何度も失敗してきた過去があるが今度こそ成功させたい。`

### 1.2 現状（コード真実）

| 項目                    | ドキュメント記述                                                 | 実コード                                               | 乖離 |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ | ---- |
| `InputHistoryState`     | CLAUDE.md §3.5 で存在                                            | `terminalManager.ts` に無し                            | ✗    |
| `recordHistory`         | coding-principles §4                                             | 無し                                                   | ✗    |
| `undo()` / `redo()`     | Tier Map T1-4 / tier-1-core.md の Acceptance Criteria すべて `x` | 無し                                                   | ✗    |
| `clearLine()`           | Known Issue 002 の Fix 節に実装コード掲載                        | 無し                                                   | ✗    |
| Cmd+Z / Cmd+Shift+Z     | T1-4 の Boundary に明記                                          | `App.tsx` にハンドラ無し                               | ✗    |
| Cmd+Backspace 履歴連動  | Known Issue 002 の Resolved                                      | `App.tsx:122-129` で `window.api.pty.write` を直接呼ぶ | ✗    |
| ShortcutsModal への記載 | -                                                                | 記載無し                                               | ✗    |

全削除の起点: `git show 479341d` "Remove all history features and add multi-window support"。
コミットメッセージ上も Undo/Redo システム（InputHistoryState / undo / redo / clearLine / resetInputHistory）を削除したと明記されている。

### 1.3 過去 3 世代の失敗ログ

読み直し対象:

- `git show 479341d^:src/renderer/services/terminalManager.ts`（削除直前版、468 行）
- `git show 479341d^:src/renderer/App.tsx`（Cmd+Z / Cmd+Shift+Z ハンドラあり、269 行）
- Known Issue 002 本文（Cmd+Backspace バイパス問題）

旧実装から抽出した **構造的弱点**:

1. **シェルのクセを JS 側で再現**しようとした。
   - `recordHistory` で `\x17` (Ctrl+W) を受けたら `currentLine.replace(/\s*\S+\s*$/, '')` と真似る。
   - zsh / bash / fish で Ctrl+W の単語境界定義が違う。`\x0b` (Ctrl+K) / `\x1bd` (Alt+D) は App 側で一切追従していなかった。
   - 結果、単語削除系ショートカットを使うと Undo 履歴が実シェル出力とズレ、戻した内容が表示と食い違う。
2. **ALT screen（TUI）判定が無い**。
   - vim / less / htop / claude-code / fzf など ALT buffer のアプリでも `onData` は発火し `recordHistory` が走る。
   - 戻り先が「prompt の入力行」と解釈できないため、TUI 中の Cmd+Z がユーザー視点で破壊的に見える。
3. **3 層防御の切り分け不明**。
   - `undoRedoInProgress`（フラグ）+ `pendingSentText`（文字列一致）+ 300ms タイマー のどれが実害を防いでいるか計測されていない。
   - 300ms 固定はパッケージ版で遅延が増えたら破綻。連続 Undo で clearTimeout してリセットしていたが、実質 "常に 300ms 遅延" と等価。
4. **IME 統合は片側しか無い**。
   - `compositionend` で `recordHistory(currentLine + e.data)` まではやる。
   - Undo で行を置換するとき IME の reconversion は起きないため、`Cmd+Z` で一旦戻して続きを打つフローは IME 的には「無」から入力し直しになる（これは仕様上妥協）。
5. **テストが削除された**。
   - 旧 `terminalManager.test.ts` は undo/redo 前提のアサーションを持っていたが、479341d で一緒に消滅。
   - 回帰を拾う仕組みが無いまま数ヶ月放置。

### 1.4 なぜ今度は成功できるか（設計上の変更点）

| 従来                                          | 今回                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| シェル状態を regex で推測                     | **シェル統合（OSC 133）で prompt 境界を認識**。無い間は "入力開始後の ASCII 連続列" のみを履歴対象に絞る                 |
| ALT screen 中も履歴記録                       | **`terminal.buffer.active.type === 'alternate'` を検出して履歴を完全停止**。Cmd+Z 自体を no-op                           |
| 3 層防御でエコーバック対策                    | **単一ガード**: `undo/redo` が発した文字列を `echoSuppressQueue` に push → `onData` 側で先頭一致したら 1 回だけスキップ  |
| Cmd+Backspace が PTY 直接書き込み             | **`terminalManager.writeWithHistory(id, payload, intent)` を唯一の API に**。raw write は `writeRaw` として別 API に分離 |
| テストが削除されていても気付かない            | **PR テンプレ + CLAUDE.md §7.4 の品質ゲートに Undo/Redo 回帰テスト必須化**                                               |
| ドキュメントが "実装済み" と書いてあるが実態× | **実装完了と同時に CLAUDE.md §3.5 / T1-4 acceptance の再チェック、Known Issue 002 の Status 再確認**                     |

---

## 2. Open Questions（着手前に User の判断を仰ぐ）

実装を開始する前に、以下 4 点だけ決めたい。**回答次第でスコープが変わる**。

### Q1. Undo の「粒度」はどれにするか

- **A案（保守的）**: 文字単位ではなく **行状態のスナップショット** を push（旧実装と同じ）。Backspace 連打後に 1 回の Cmd+Z で「連打前の状態」まで戻る。
- **B案（エディタ的）**: 「打鍵ストローク単位」で push。Cmd+Z が「1 文字ずつ戻る」挙動になる。
- **C案（ハイブリッド）**: 通常は行状態、ただし 300ms 以内の連続入力は 1 履歴に合流（VS Code の word boundary と同じ）。

推奨: **A 案**（過去実装と整合、実装量も少なく、ターミナルの "1 行 = 1 コマンド" という文脈と噛み合う）。

### Q2. ALT screen（TUI アプリ）での Cmd+Z 挙動

- **A案**: 完全 no-op（Cmd+Z を見ても何も起きない）。
- **B案**: ALT screen に入った瞬間に Undo 履歴を凍結、出た瞬間に再開。
- **C案**: ALT screen 中はアプリ側の `Cmd+Z` をそのまま ESC シーケンス変換してアプリに渡す（vim の `u` を呼ぶ等）。

推奨: **A 案**。C は便利だがアプリごとに差異が大きく、ユーザーの学習負荷も高い。

### Q3. シェル統合（OSC 133）の必須度

- Tier-3 に `T3-3 シェル統合（候補）`。
- **A案**: OSC 133 **なし**でも動くようにする。pre-exec 以前の ASCII 入力は記録、Enter で確定 → 履歴クリア、の単純モデルで妥協。
- **B案**: OSC 133 実装を先に完了させてから Undo/Redo を着手（T3-3 を T1-4 の前提に昇格）。

推奨: **A 案**でまず動かす → 将来 B で堅牢化。現状でも OSC 7770（本プロジェクト独自）は既にあるので、同じ精神で最小導入。

### Q4. Known Issue 002 の再発を今回で直すか

Cmd+Backspace / Cmd+K / Option+Backspace / Shift+Enter が現在 `App.tsx` で `window.api.pty.write` を直接呼んでおり、履歴と PTY カーソル位置が食い違う罠を再び抱えている。

- **A案**: 今回の PR で **まとめて `terminalManager` 経由に修正**（推奨）。
- **B案**: Undo/Redo だけ入れ、002 再発は別 PR で直す。

推奨: **A 案**。同じ PR で直さないと Undo/Redo の初日からバグ報告が来る。

---

## 3. Architecture

### 3.1 データ構造（新）

```typescript
// terminalManager.ts 内部
interface InputHistoryState {
  undoStack: string[]; // 行状態のスナップショット
  redoStack: string[];
  currentLine: string;
  // Echo 抑止: undo/redo で送信した payload を先頭一致で 1 回だけ skip
  echoSuppressQueue: string[];
  // ALT screen ガード
  altScreenActive: boolean;
}
```

### 3.2 唯一の PTY 入口

```typescript
// 履歴を伴う書き込み（ショートカット経由は全部こっち）
export function writeWithHistory(
  id: string,
  payload: string,
  intent:
    | "clearLineBackward" // \x15
    | "clearLineForward" // \x0b
    | "deleteWordBackward" // \x17
    | "deleteWordForward" // \x1bd
    | "newline" // \n
    | "type", // 通常入力（onData 経由）
): void;

// 履歴に触らない raw write（OSC 制御シーケンス等、入力行に影響しないもの）
export function writeRaw(id: string, payload: string): void;
```

App.tsx のショートカットは **全部 `writeWithHistory` を呼ぶ**。`window.api.pty.write` の直接呼び出しを App から禁止（lint ルール or grep で検出）。

### 3.3 エコーバック抑止（単一層）

```
[undo 発動]
  echoSuppressQueue.push(previousLine)
  pty.write('\x15' + previousLine)    // clear + re-input

[PTY echoback 受信 → onData 発火]
  const expected = echoSuppressQueue[0]
  if (expected && data.startsWith(expected)) {
    echoSuppressQueue.shift()  // 1 回だけ skip
    return  // recordHistory しない
  }
  recordHistory(currentLine + data)
```

- タイマー不要（連続 Undo でも queue が長くなるだけ）。
- シェルによって echoback の形が異なる場合（色付け・改行有無）は queue を捨てる補助タイマー（500ms）だけ保険に残す。

### 3.4 ALT screen 検出

xterm.js の `terminal.buffer.active.type` が `'alternate'` / `'normal'` を返すので、`onData` / `undo` / `redo` の冒頭で判定して分岐。`onScreenChanged` 相当の API は無いので毎回チェックで十分軽い。

### 3.5 IME 統合

既存 `compositionend` ハンドラ内で `recordHistory(currentLine + e.data)` を呼ぶ。Undo でカーソル行を置換しても IME の内部状態には触れない（仕様上の割り切り）。

---

## 4. Steps

### Phase 0: 合意（§2 Open Questions）

- [ ] Q1〜Q4 の回答をもらう
- [ ] 本ファイルの Status を IN_PROGRESS に更新

### Phase 1: 基盤再構築

- [ ] `terminalManager.ts` に `InputHistoryState` / `echoSuppressQueue` / `altScreenActive` を復活
- [ ] `recordHistory(id, newLine)` を private 化（`onData` 側から呼ぶ）
- [ ] `writeWithHistory` / `writeRaw` の二つに PTY 書き込みを分離
- [ ] `undo(id)` / `redo(id)` / `clearLine(id)` / `resetInputHistory(id)` を再実装
- [ ] ALT screen ガードを `onData` / `undo` / `redo` に挿入
- [ ] destroy 時に echoSuppressQueue / タイマーをクリーンアップ

### Phase 2: ショートカット配線（App.tsx）

- [ ] Cmd+Z / Cmd+Shift+Z ハンドラ追加 → `terminalManager.undo/redo` 経由
- [ ] Cmd+Backspace を `writeWithHistory(id, '\x15', 'clearLineBackward')` に変更（Known Issue 002 再発 FIX）
- [ ] Cmd+K を `writeWithHistory(id, '\x0b', 'clearLineForward')` に変更
- [ ] Option+Backspace を `writeWithHistory(id, '\x17', 'deleteWordBackward')` に変更
- [ ] Option+D を `writeWithHistory(id, '\x1bd', 'deleteWordForward')` に変更
- [ ] Shift+Enter は履歴非依存なので `writeRaw` のまま（ただし改行履歴として recordHistory は呼ぶ）
- [ ] Cmd+← / Cmd+→（カーソル移動）は `writeRaw`（履歴不要）

### Phase 3: IME 統合

- [ ] `compositionend` ハンドラで `recordHistory(currentLine + e.data)` を呼ぶ
- [ ] `undo` 実行中に compositionend が起きた場合は echoSuppress を強制スキップ（queue リセット）

### Phase 4: テスト再構築

- [ ] `terminalManager.test.ts` に以下シナリオを追加:
  - [ ] 通常入力 → undo で 1 段戻る
  - [ ] Backspace で 1 文字削除 → undo で戻る
  - [ ] Ctrl+U (`\x15`) で行クリア → undo で戻る（**Known Issue 002 回帰**）
  - [ ] Enter で履歴クリア
  - [ ] 連続 undo 複数回で最古に到達、それ以降は null
  - [ ] undo → redo で復元
  - [ ] redo 後に新規入力で redoStack クリア
  - [ ] MAX_UNDO_STACK_SIZE=100 超過で最古破棄
  - [ ] ALT screen 中は recordHistory / undo / redo が no-op
  - [ ] echoSuppressQueue の 1 回限り先頭一致スキップ
  - [ ] IME compositionend で履歴記録

### Phase 5: UI 表示同期

- [ ] `ShortcutsModal.tsx` に "Line Editing" カテゴリへ `⌘ Z` / `⌘ ⇧ Z` 追加
- [ ] `ShortcutsModal.test.tsx` の期待リスト更新

### Phase 6: ドキュメント同期

- [ ] `.claude/docs/requirements/tier-1-core.md` の T1-4 acceptance を再チェック（`[x]` → 再実装後に `[x]` で復活）
- [ ] `.claude/docs/known-issues/002-cmd-backspace-undo-history.md` を再検査:
  - 現状 "Fixed" だが 479341d で巻き戻り。Status=Monitoring に降格し "Regressed then refixed on 2026-04-XX" を追記
- [ ] CLAUDE.md §3.5 の「エコーバック 3 層防御」記述を新構造（単一ガード）に更新
- [ ] `docs/vision/coding-principles.md` §4 を同様に更新（300ms タイマーの記述を削除、echoSuppressQueue モデルに差し替え）
- [ ] CLAUDE.md §6.3 の規約「PTY 直接書き込みで履歴に影響するものは `terminalManager` 経由」を強化し、"App.tsx から `window.api.pty.write` を直接呼ばない" と明記

### Phase 7: 動作確認（手動）

- [ ] `npm run dev` で golden path:
  - "hello" 入力 → Cmd+Z → 空行 → Cmd+Shift+Z → "hello"
  - "hello world" → Ctrl+W（Option+Backspace）→ "hello " → Cmd+Z → "hello world"
  - "abc" → Cmd+Backspace → 空 → Cmd+Z → "abc"（**002 回帰シナリオ**）
  - vim を開く → 何か打つ → Cmd+Z → 何も起きない（TUI ガード）
  - 日本語「こんにちは」入力 → Cmd+Z → 空（現状の妥協仕様確認）
- [ ] `npx electron-builder --mac --dir` でパッケージ版も同じ golden path を通す

### Phase 8: クローズ

- [ ] `npm test` と `npm run build` グリーン
- [ ] PR 作成（`feat: reintroduce line-level undo/redo with single-layer echo suppression`）
- [ ] プランを `.claude/archive/` に移動、Status=COMPLETED
- [ ] MEMORY.md / HISTORY.md を task-tracker 経由で更新

---

## 5. Files

| File                                                          | Operation | Notes                                                                                                             |
| ------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/renderer/services/terminalManager.ts`                    | Modify    | `InputHistoryState` / `undo` / `redo` / `clearLine` / `writeWithHistory` / `writeRaw` / ALT screen ガード追加     |
| `src/renderer/App.tsx`                                        | Modify    | Cmd+Z / Cmd+Shift+Z 追加、Cmd+Backspace 他を `writeWithHistory` 経由に変更、`window.api.pty.write` 呼び出しを撲滅 |
| `src/renderer/components/ShortcutsModal.tsx`                  | Modify    | Line Editing に `⌘ Z` / `⌘ ⇧ Z` 追加                                                                              |
| `src/renderer/services/__tests__/terminalManager.test.ts`     | Modify    | 11 個の回帰シナリオ追加（Phase 4 参照）                                                                           |
| `src/renderer/components/__tests__/ShortcutsModal.test.tsx`   | Modify    | 新エントリの期待リスト更新                                                                                        |
| `.claude/docs/requirements/tier-1-core.md`                    | Modify    | T1-4 acceptance 再チェック                                                                                        |
| `.claude/docs/known-issues/002-cmd-backspace-undo-history.md` | Modify    | Status=Monitoring に降格 + Regressed/Refixed 記述                                                                 |
| `.claude/docs/known-issues/INDEX.md`                          | Modify    | 002 を Fixed → Monitoring へ移動                                                                                  |
| `.claude/CLAUDE.md`                                           | Modify    | §3.5 を新構造に更新、§6.3 に "App から `window.api.pty.write` 直接呼び出し禁止" を追加                            |
| `.claude/docs/vision/coding-principles.md`                    | Modify    | §4 を単一ガードモデルに書き換え                                                                                   |
| `.claude/MEMORY.md` / `.claude/HISTORY.md`                    | Modify    | task-tracker 経由                                                                                                 |
| `.claude/2026-04-23-cmd-z-undo-redo.md` (本ファイル)          | Create    | 本計画書                                                                                                          |
| `.claude/archive/2026-04-23-cmd-z-undo-redo.md`               | Move      | 完了時                                                                                                            |

---

## 6. Verification

### 6.1 単体テスト（`npm test`）

- [ ] `terminalManager.test.ts` の 11 シナリオが green
- [ ] `ShortcutsModal.test.tsx` のスナップショット更新 green
- [ ] カバレッジで `undo` / `redo` / `writeWithHistory` が 90%+ 到達

### 6.2 手動テスト（Phase 7 の golden path が全て通る）

観察可能な合否シグナル:

| シナリオ                                    | 期待                                   | NG 時の疑い                                              |
| ------------------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| "hello" → Cmd+Z → Cmd+Shift+Z               | 空 → "hello"                           | echoSuppressQueue が動いてない / clear + re-input の順序 |
| "abc" → Cmd+Backspace → Cmd+Z               | "abc" 全文復元（1 文字欠落なし）       | **Known Issue 002 再発**。`writeWithHistory` 未経由      |
| vim 起動中に Cmd+Z                          | 無反応（vim の内部 `u` も呼ばれない）  | ALT screen ガード漏れ                                    |
| "hello world" → Option+Backspace → Cmd+Z    | "hello world" 復元                     | Ctrl+W を `writeWithHistory` 未経由 / 単語境界推測が違う |
| Cmd+Z を 150 回連打                         | 100 回で止まる（最古が破棄されている） | `MAX_UNDO_STACK_SIZE` の shift 漏れ                      |
| パッケージ版（`--mac --dir`）で同じシナリオ | 全て dev と同じ                        | echoback 遅延 → queue が溜まりすぎる（補助タイマー確認） |

### 6.3 ドキュメント整合

- [ ] `grep -rn "undoStack\|recordHistory\|writeWithHistory" src/` の結果がコードとドキュメントで一致
- [ ] CLAUDE.md §3.5 / coding-principles §4 / T1-4 / Known Issue 002 / ShortcutsModal の 5 箇所で矛盾がない

### 6.4 静的チェック

- [ ] `App.tsx` 内に `window.api.pty.write(` の呼び出しが存在しない（grep で 0 件）
- [ ] `npm run build` green
- [ ] TypeScript strict モードで新 API に明示的返り値型

---

## 7. Rollback Plan

実装途中で echoback 抑止が破綻し Undo が使い物にならない場合:

1. Phase 2 のショートカット配線だけ revert（Cmd+Z / Cmd+Shift+Z 無効化）
2. Phase 1 の `writeWithHistory` / ALT ガードは残す（Known Issue 002 の再発だけは直る）
3. 本プランを Status=BLOCKED にし、失敗原因を Known Issue として NNN-<slug> に起票

---

## 8. Non-Goals（このプランでやらないこと）

- コマンドヒストリ（シェルの `history` / Ctrl+R）の改変
- 複数行入力の Undo（heredoc 中など）
- Undo ツリー / 分岐型 Undo
- OSC 133 の完全実装（T3-3 の別タスク）
- グローバル（複数ペイン横断）Undo
