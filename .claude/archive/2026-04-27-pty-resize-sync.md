# PTY Resize Sync — Scrollback の cols 不整合修正

- **Status**: COMPLETED
- **Created**: 2026-04-27
- **Task**: 長いセッションで scrollback が極狭幅 (1〜2 文字) で固定表示される問題の根治
- **Project path**: `/Users/newlife/dev/apps/terminal-division`
- **Related**:
  - `.claude/docs/requirements/tier-1-core.md` §T1-2 (xterm.js + node-pty)
  - `src/renderer/components/TerminalPane.tsx`
  - `src/renderer/services/terminalManager.ts`
  - `src/renderer/components/SplitContainer.tsx`
  - 想定 Known Issue: `.claude/docs/known-issues/002-scrollback-cols-mismatch.md`（本計画完了時に追加）

---

## Context

### 動機（再現状況）

ユーザー報告のスクリーンショット（2026-04-27 22:04:38 / 22:04:52）で、ペイン 3 (zsh) の scrollback が**左端に 1〜2 文字ずつ縦に並ぶ**異常表示になっていた。具体的には `Th / il / e' / Al / de / es / Al` の断片や、孤立した `8` のみ等で、右側は完全な空白。bullet (●/○/✓) の位置だけは正しい。Claude Code (CLI) の TUI ストリーミング描画 (`\r` + `\x1b[K` 多用) を長時間流したセッションで発生している。

### 根本仮説（Web 調査・コード調査で裏付け済み）

1. **xterm.js v5 の `terminal.resize(cols, rows)` は scrollback を含めて自動 reflow される**（PR #1864 以降のデフォルト挙動）。つまり「scrollback が当時の幅で固定」は xterm 仕様ではない。
2. → 真の原因は **`terminal.resize()` が現在のペイン実幅を反映できていない瞬間がある**こと。`fit()` が極狭サイズ (cols=2 等) を一度確定し、その値で動作している間に Claude の出力が流れ込み、「現状の cols」が DOM 実幅と乖離する。
3. cols を後で正しい値に揃え直せば xterm が reflow するため、**修正は「resize の到達保証」と「cols の正しさ保証」の 2 軸**でよい。

### 具体的な原因経路（根拠付き）

| #   | 経路                                                                    | 根拠 (file:line)                                                                                                                                                                                                             | 影響                                                                                                         |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A   | **viewMode `md` → `cli` 切替時に同期 `fit()` が無い**                   | `TerminalPane.tsx:75-172` の `useLayoutEffect` 依存配列が `[id, closeTerminal]` のみ。`showMd` 変化で再走しない。`TerminalSubHeader` の `switchToMode` も fit を呼ばない                                                     | `display:none` の間に幅が変わると、復帰直後 ResizeObserver の 50ms 遅延中に古い cols のまま PTY 出力が流れる |
| B   | **react-resizable-panels の split drag が xterm に通知されていない**    | `SplitContainer.tsx:65-71` で `<Panel>` に `onResize` 未設定。実装は v4.5.9 で `onResize?: (panelSize: PanelSize, id, prev) => void` をサポート (`node_modules/react-resizable-panels/dist/react-resizable-panels.d.ts:299`) | ドラッグ完了直後 ResizeObserver が観察するまで間がある                                                       |
| C   | **`fit()` の lastSizes キャッシュが「PTY が知っているサイズ」と無関係** | `terminalManager.ts:464-496`。同 cols を返すと null で `pty.resize` を抑止する                                                                                                                                               | md→cli 復帰時など、PTY 側の cols が古いまま xterm 側だけ正しくても resize が再送されない                     |
| D   | **`fitAddon.fit()` の例外時にリトライしない**                           | `terminalManager.ts:493-495` で `catch { return null }` のみ。display:none 直後の `offsetWidth=0` 時に発生する                                                                                                               | PTY が永遠に古い cols のまま固定                                                                             |
| E   | **`rafDebounceWithDelay` の 50ms 遅延**                                 | `rafDebounce.ts:24-30`、`TerminalPane.tsx:158-161`                                                                                                                                                                           | リサイズ → fit 反映に最大 ~70ms。Claude のストリーミング 1 frame 分のテキストが旧 cols で記録される          |
| F   | **PTY spawn 初期 cols=80 ハードコード**                                 | `pty-manager.ts:60-172`。renderer 側 resolve 後 `pty.resize` (`TerminalPane.tsx:139`) でリカバリしているが、spawn 直後〜resolve 間 (~数 ms) に出力された行は cols=80 で記録される                                            | 起動時に xterm 実幅が 80 と異なると一瞬だけ表示崩れ                                                          |

### 制約

- **xterm.js の reflow はデフォルト ON だが、resize() 呼び出しが必要**。再描画自体は xterm に任せる。
- **PTY 側 `\x1b[2J` `\x1b[H` 等のクリアシーケンスを送らない**。Claude Code 自身の SIGWINCH 処理を妨げない。
- **既存 IPC 最適化（同サイズ resize を抑止）は維持する**。撤去すると IPC 量が大幅に増える。代わりに `invalidate` 機構を追加する。
- **session 永続化への影響なし**。永続化対象は cols/rows 含まない（`session-state.ts` 確認済）。
- **Windows 互換性は要件外**（CLAUDE.md §2 macOS 第一級）。

### Non-goals

- xterm.js の「scrollback の任意行を後から手動 reflow する」追加処理（既に terminal.resize が処理する）
- pty-manager.ts の spawn 時 cols/rows の dynamic 化（spawn → resize 経路で十分救える）
- ResizeObserver の完全廃止（fallback として残す）
- ペインヘッダーへの「cols/rows 表示」UI 追加（debug 用には devtools で見れば足りる）

---

## Steps

### Phase 1 — viewMode 切替時の同期 fit（最重要）

- [ ] **1.1** `TerminalPane.tsx` に `showMd` の遷移を観察する `useLayoutEffect` を追加。`showMd: true → false` の遷移で同期的に `handleFit()` を呼ぶ。`useLayoutEffect` で paint 前に実行し、CodeMirror の display 切替後すぐ xterm の cols を実幅に揃える。
- [ ] **1.2** `terminalManager.ts` に `invalidateLastSize(id: string): void` を export として追加。`lastSizes.delete(id)` するだけ。同 cols/rows でも次回 `fit()` で必ず新しいサイズを返すようにする。
- [ ] **1.3** Phase 1.1 の useLayoutEffect 内で `invalidateLastSize(id)` → `handleFit()` の順に呼ぶ。

### Phase 2 — react-resizable-panels の onResize 連動

- [ ] **2.1** `SplitContainer.tsx` の `<Panel>` に `onResize` を設定。引数の `id`（葉ペインの場合は paneId）が `paneNumberMap` に存在する（= 葉ペイン）場合のみ `terminalManager.fit(paneId)` + `window.api.pty.resize(paneId, cols, rows)` を呼ぶ。コールバックは drag 完了時の発火（型上の説明と CHANGELOG 確認済み）なので debounce 不要。
- [ ] **2.2** Panel.onResize の発火が ResizeObserver より先に走る場合の冪等性確認: `fit()` の lastSizes キャッシュが効いて二重 IPC を抑止することを確認。

### Phase 3 — fit() の堅牢化

- [ ] **3.1** `terminalManager.ts` の `fit()` で `fitAddon.fit()` 直後に `instance.terminal.cols/rows` のどちらかが 0 または NaN なら null 返却する直前に **rAF 1 回だけリトライ**するブランチを追加。リトライも失敗したら null（既存と同じ）。
- [ ] **3.2** `rafDebounce.ts` の `rafDebounceWithDelay` を呼んでいる箇所のうち `TerminalPane.tsx` の ResizeObserver 経路は **delay を 0 に縮める**。50ms 遅延の必要性は「滑らかなリサイズ感」だが、Panel.onResize と useLayoutEffect で本来のタイミングで fit するので、observer は補助に格下げできる。

### Phase 4 — テスト

- [ ] **4.1** `src/renderer/services/__tests__/terminalManager.test.ts` に `invalidateLastSize` のテスト追加: 同サイズで 2 回目の `fit()` が新しいサイズを返すこと。
- [ ] **4.2** `src/renderer/services/__tests__/terminalManager.test.ts` に「`fitAddon.fit` が一度例外 → 次の rAF で成功」を mock で検証。
- [ ] **4.3** `src/renderer/components/__tests__/TerminalPane.test.tsx` に viewMode 切替テストを追加: `showMd: false → true → false` の遷移で `terminalManager.fit` が呼ばれ、`window.api.pty.resize` が発火することを spy で確認。
- [ ] **4.4** `src/renderer/components/__tests__/SplitContainer.test.tsx` に Panel.onResize から葉ペインの fit が呼ばれることのテスト追加（react-resizable-panels の Panel を mock 経由でコールバック発火）。

### Phase 5 — Known Issue 化

- [ ] **5.1** `.claude/docs/known-issues/002-scrollback-cols-mismatch.md` を `_TEMPLATE.md` ベースで作成。Status=Fixed、Root Cause（経路 A〜F）、修正点（Phase 1〜3）、再発防止 Lessons を記載。
- [ ] **5.2** `.claude/docs/known-issues/INDEX.md` の Fixed セクションに 002 を追記。

### Phase 6 — Manual QA & Build

- [ ] **6.1** `npm run dev` で起動し、ペイン 1 つ → ウィンドウ最小幅まで縮める → 元に戻す → scrollback の wrap が正しいか確認。
- [ ] **6.2** ペイン 3 つに分割した状態で Claude Code (CLI) を 1 つで実行 → 別ペインの分割境界をドラッグ → cols が即追従するか確認。
- [ ] **6.3** Markdown ファイルを `.md` シングルクリックで開く → 戻す → 戻った瞬間に何かタイプして wrap が正しいか確認。
- [ ] **6.4** `npm test`（vitest）と `npm run build`（electron-vite）が通ること。

---

## Files

| File                                                        | Operation             | Notes                                                                                      |
| ----------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `src/renderer/components/TerminalPane.tsx`                  | Modify                | 経路 A 修正: showMd 遷移 useLayoutEffect 追加。ResizeObserver の rafDebounce delay を 0 に |
| `src/renderer/services/terminalManager.ts`                  | Modify                | 経路 C/D 修正: `invalidateLastSize(id)` 追加、`fit()` に rAF 1 回リトライ追加              |
| `src/renderer/components/SplitContainer.tsx`                | Modify                | 経路 B 修正: `<Panel>` に `onResize` を仕込み、葉ペインで fit + pty.resize                 |
| `src/renderer/utils/rafDebounce.ts`                         | Read のみ（変更なし） | 50ms→0 は呼び出し側で対応する。util 自体は再利用可能性のため改変しない                     |
| `src/renderer/services/__tests__/terminalManager.test.ts`   | Modify                | invalidateLastSize / fit リトライのテスト追加                                              |
| `src/renderer/components/__tests__/TerminalPane.test.tsx`   | Modify                | viewMode 切替時の fit 呼び出しテスト追加                                                   |
| `src/renderer/components/__tests__/SplitContainer.test.tsx` | Modify                | Panel.onResize 経由の葉ペイン fit テスト追加                                               |
| `.claude/docs/known-issues/002-scrollback-cols-mismatch.md` | Add                   | Root Cause + 修正点 + Lessons                                                              |
| `.claude/docs/known-issues/INDEX.md`                        | Modify                | Fixed に 002 を追加                                                                        |
| `.claude/MEMORY.md` / `.claude/HISTORY.md`                  | Modify                | task-tracker 経由で更新（手動編集しない）                                                  |

### 触らないファイル（明示）

- `src/main/pty-manager.ts` — 経路 F は許容範囲。spawn cols=80 のままでも resolve 後の resize で復旧する。
- `src/main/types/session-state.ts` / `src/renderer/services/sessionPersist.ts` — 永続化は cols/rows を含まない設計を維持。
- `src/renderer/components/MarkdownEditor.tsx` — Markdown 側の表示には影響しない。

---

## Verification

各項目は手動 / 自動の別を明示。

### 自動

- [ ] `npm test` が 379 件 + 追加分すべて pass
- [ ] `npm run build` が成功（electron-vite build で main / preload / renderer すべて）
- [ ] 新規テスト：
  - [ ] `invalidateLastSize` が次回 fit で同サイズでも新値を返す
  - [ ] `fit()` が `fitAddon.fit` 例外時に rAF リトライする
  - [ ] TerminalPane viewMode `md→cli` 遷移で `fit` + `pty.resize` が呼ばれる
  - [ ] SplitContainer の Panel.onResize から葉ペインの fit + pty.resize が呼ばれる

### 手動（再現テスト）

- [ ] ペイン 1 つ + Claude Code (CLI) で長時間出力中、ウィンドウ幅を急縮 → 急拡大 → scrollback の各行が現在の cols 幅で wrap されること（過去行も含めて）
- [ ] 6 ペインに分割した状態で各 Separator を高速ドラッグ → 各ペインの prompt 行 / scrollback が即座に追従すること
- [ ] `.md` シングルクリック → 編集モード → CLI 復帰直後に `echo $COLUMNS` を実行 → 表示値と `term.cols` が一致すること
- [ ] セッション復元（再起動）後、復元された 3 ペインそれぞれの cols が DOM 幅と一致（devtools で `__td_pane(id).cols` が読めるよう一時 expose して検証 → 検証後削除）

### 失敗時の判定

- 1 つでも自動テストが落ちる → Phase 4 を見直し
- 手動テスト 1 が再現する → Phase 1 / 3 の同期 fit が機能していない
- 手動テスト 2 が再現する → Phase 2 の Panel.onResize 接続漏れ
- 手動テスト 3 が再現する → Phase 1.1 の useLayoutEffect 依存ミス

---

## Risks / Open questions

1. **Panel.onResize の頻度**: CHANGELOG では「ポインター離し後に発火」と読めるが、実装が percentage ベースで 0.01 単位なら drag 中も多発する可能性がある。多発時は Phase 2.2 の冪等性で吸収できることを確認する。
2. **`useLayoutEffect` 内で同期的に IPC を送ることの是非**: `pty.resize` は ipcRenderer.send（fire-and-forget）なので safe。ただし StrictMode 二重実行で IPC が 2 倍出る可能性がある → 既存と同じ挙動なので新規リスクなし。
3. **`fit()` の rAF リトライが描画遅延を生む可能性**: 1 回限定 / 失敗時は静かに諦めるので体感影響は無視できる。
4. **lastSizes invalidate の漏れ**: viewMode 切替以外でも DOM 幅が変わる経路（例: フルスクリーン）では `Panel.onResize` 経路で sizing キャッシュが正しく更新される設計。サイドバー開閉は `Panel.onResize` で吸収される。
