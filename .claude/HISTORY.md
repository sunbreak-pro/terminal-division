# HISTORY.md - 変更履歴

### 2026-04-25 - vi-mode 環境で Cmd+←/→/K が ^A/^E/^K として echo されるバグを修正

#### 概要

ユーザの `$EDITOR=vim` / `$VISUAL=vim` 設定により zsh の main keymap が `viins` になり、`^A` / `^E` / `^K` が `self-insert` 扱い（reverse video の `\e[7m^A\e[27m` literal echo）、`\eb` / `\ef` / `\ed` が `undefined-key` になっていた。前回 (6f10234) のフォールバックタイマ式 shell readiness 判定にも race（zsh 起動 2.66 秒 vs 3 秒タイマ）が残っていたため、(1) shell-integration `.zshrc` で Terminal Division ショートカットが送る制御コード群を `bindkey` で readline 互換にバインド、(2) フォールバックタイマを撤去し OSC 7770;A 受信のみで `shellReady` 判定、(3) OSC 7770;A の送信を `precmd` から `zle-line-init` に移して zle が raw mode を確立した後にだけ発火させる、の 3 段階で根本修正。

#### 変更点

- **shell-integration.ts (createZshrc)**: `bindkey '^A' beginning-of-line` / `'^E' end-of-line` / `'^K' kill-line` / `'^U' backward-kill-line` / `'^W' backward-kill-word` / `'\eb' backward-word` / `'\ef' forward-word` / `'\ed' kill-word` を user `.zshrc` source 後に注入。vi モード派ユーザの hjkl 等は壊さず、Terminal Division ショートカットで送る制御コードだけ readline 互換に強制
- **shell-integration.ts (createZshrc)**: OSC 7770;A 送信を `__td_precmd` から `__td_zle_line_init` (`zle -N zle-line-init __td_zle_line_init`) に移動。`precmd` は zsh が prompt を描画する _前_ (= zle 起動・raw mode 切替前) に走るため、`shellReady=true` 時点でまだ canonical mode + echoctl のままで `\x01` が `^A` として echo される race を解消
- **terminalManager.ts**: `SHELL_READY_FALLBACK_MS` 定数 / `TerminalInstance.shellReadyTimer` フィールド / `getOrCreate()` 内 `setTimeout` 設置 / `destroy()` のタイマクリア / OSC 7770;A ハンドラの `clearTimeout` を全削除。`shellReady` は OSC 7770;A 受信のみで true。シェル統合 OSC が来ない構成（fish 等）では永久に false となるが、誤った ^X echo よりは安全
- **terminalManager.ts**: `isShellReady` の JSDoc を「OSC 7770;A 受信のみ」に更新
- **terminalManager.test.ts**: 旧 `isShellReady becomes true after the fallback timer fires` テストを「フォールバックなしで 60s 経っても false」「OSC 7770 ハンドラ "A" 発火で true」の 2 ケースに置換。130 / 130 グリーン
- **デバッグセッション**: 真因特定は実環境ログ（`PTY OUTPUT contains ^A/^E/^K (canonical mode echo!): "[7m^A[27m"`）と PTY 内 `bindkey '^A'` 出力（`"^A" self-insert`、main keymap=`viins`）に依拠。subshell の `/bin/zsh -i -c` テストでは `EDITOR` 未設定で emacs に落ち気付けなかった点を反省として記録

### 2026-04-25 - シェル起動中のショートカット由来 PTY 書き込みを抑制 + キー判定の toLowerCase 統一

#### 概要

`Cmd+←` / `Cmd+→` を押すと `^A` / `^E` が literal echo される問題を修正。原因は PTY 起動直後の数百ms〜2 秒、シェルが canonical mode (echoctl 有効) で readline (zle) がまだアクティブでないため、`\x01` / `\x05` 等の制御コードが `^A` / `^E` として echo されること。`OSC 7770;A`（プロンプト直前マーカー）の初回受信を「readline アクティブ化」のシグナルとして扱う `shellReady` 状態を `terminalManager` に追加し、起動完了までショートカット由来の PTY 書き込みを silent suppress するゲートを実装。あわせてキー判定の `e.key === "x"` を `.toLowerCase()` に統一して CapsLock 不感問題を解消し、`Cmd+Shift+Arrow` / `Cmd+Shift+A` のドキュメントも追記。

#### 変更点

- **terminalManager.ts**: `TerminalInstance.shellReady` / `shellReadyTimer` フィールド追加。`OSC 7770;A` 初回受信またはフォールバック 3 秒タイマで true。`destroy()` でタイマを clearTimeout。`isShellReady(id)` を export
- **terminalManager.ts**: `writeWithHistory` / `undo` / `redo` を `!shellReady` で silent suppress（履歴汚染も同時防止）
- **App.tsx**: `Cmd+←` / `Cmd+→` / `Option+←` / `Option+→` の直接 `pty.write` 4 箇所に `terminalManager.isShellReady(activeTerminalId)` ガード追加
- **App.tsx**: `Cmd+D` / `Cmd+W` / `Cmd+Z` / `Cmd+K` / `Option+D` の `e.key === "x"` を `e.key.toLowerCase() === "x"` に統一（CapsLock ON で発火しなかった問題を解消）
- **ShortcutsModal.tsx**: 未掲載だった `⌘ ⇧ ←/→/↑/↓` と `⌘ ⇧ A`（現在のプロンプト行を選択）を Line Editing カテゴリに追記
- **terminalManager.test.ts**: `createReadyInstance` ヘルパーを導入し既存 9 件の undo/redo テストを置換。`shell readiness gating` describe ブロックに `isShellReady` の初期 false / フォールバック発火 / `writeWithHistory` 抑制 / `undo`/`redo` 抑制 / 非存在 ID の 5 件追加。129 / 129 グリーン
- **再現テストでの根本原因確認**: node-pty に直接 `\x01` を T+500ms / +1000ms / +1500ms / +2000ms で送ると全て `^A` が echo され、T+2500ms（プロンプト到達後）からは正常に `\b\b\b\b\b` 等のカーソル移動シーケンスのみ返ることを確認

### 2026-04-23 - 入力行 Cmd+Z / Cmd+Shift+Z Undo/Redo を再実装 + Undo/Redo ドキュメントを全削除（計画書: archive/2026-04-23-cmd-z-undo-redo.md）

#### 概要

2026-02-20 のコミット `479341d` で全削除されていた Undo/Redo 機能を、旧実装の 3 層防御を廃した簡素モデルで再実装した。併せて Known Issue 002 / CLAUDE.md §3.5 / coding-principles §4 / tier-1-core.md T1-4 / tier-2-supporting.md Cmd+Z 行 / vision/core.md 3 項目 / code-explanation/05-advanced-features.md の Undo/Redo 章 など、実装と乖離していた Undo/Redo 関連ドキュメントを全削除。Cmd+Backspace / Cmd+K / Option+Backspace / Option+D / Shift+Enter を履歴記録を伴う `writeWithHistory` 経由に変更し、Known Issue 002 の再発（479341d で巻き戻っていた）も同時に解消した。

#### 変更点

- **terminalManager.ts**: `InputHistoryState` / `applyHistoryDelta` / `pushHistoryState` / `isAltScreen` / `writeWithHistory` / `undo` / `redo` を追加。最大 100 履歴、Enter で履歴リセット、ALT screen（vim / less 等 TUI）中は no-op
- **App.tsx**: Cmd+Z / Cmd+Shift+Z ショートカット追加。Cmd+Backspace / Cmd+K / Option+Backspace / Option+D / Shift+Enter を `terminalManager.writeWithHistory` 経由に変更
- **ShortcutsModal.tsx**: Line Editing カテゴリに `⌘ Z` / `⌘ ⇧ Z` を追加
- **terminalManager.test.ts**: Undo/Redo 回帰テスト 10 件追加（通常入力 / Backspace / Ctrl+U 後の復元 / Enter でリセット / 100 超過で shift / redoStack クリア / ALT screen no-op / pty.write 発行確認 / writeWithHistory 経由の履歴記録 など）。全 123 テスト green
- **削除されたドキュメント**: `docs/known-issues/002-cmd-backspace-undo-history.md` / CLAUDE.md §3.5 / coding-principles §4 / tier-1-core.md T1-4 / tier-2-supporting.md Cmd+Z 行 / vision/core.md 3 項目 / code-explanation/05-advanced-features.md の Undo/Redo 章 / 01-architecture-overview.md / 03-data-flow.md / README.md の Undo/Redo 言及 / known-issues/INDEX.md 002 行
- **簡素化**: 旧実装の `undoRedoInProgress` / `pendingSentText` / 300ms タイマーの 3 層防御は不採用。PTY エコーバックは `terminal.write` 経由で画面反映されるのみで `terminal.onData` を発火しないため、履歴汚染経路が構造的に存在しない
- **プラン**: `.claude/2026-04-23-cmd-z-undo-redo.md` を `.claude/archive/` に移動、Status=COMPLETED 付与

### 2026-04-23 - ペインヘッダーに + ボタン + Cmd+O でファイルパス挿入機能を追加

#### 概要

ターミナルに画像やファイルを渡す用途（特に Claude Code CLI で画像を参照する場面）向けに、各ペインヘッダー右端に + ボタンを追加し、Cmd+O ショートカットからネイティブのファイル選択ダイアログを開いて選択パスを現在のカーソル位置に PTY write する機能を実装した。複数選択対応、スペース/ダブルクォート含有パスは自動クオート、ダイアログクローズ後はターミナルへフォーカス復帰。

#### 変更点

- **ipc-handlers.ts**: `dialog:selectFiles` IPC ハンドラ追加。`openFile` + `multiSelections` + `treatPackageAsDirectory` で macOS ネイティブファイルピッカーを開く (src/main/ipc-handlers.ts:68-87)
- **preload/index.ts**: `window.api.dialog.selectFiles(): Promise<string[] | null>` を公開 (src/preload/index.ts:55-56)
- **insertFiles.ts（新規）**: 純粋関数 `formatPaths`（スペース/ダブルクォート含有時のみクオート、`"` は `\"` エスケープ、複数パスはスペース区切り）と `promptAndInsertFiles`（ダイアログ → PTY write → focus 復帰、キャンセル/エラー時も focus 復帰）(src/renderer/utils/insertFiles.ts)
- **TerminalSubHeader.tsx**: 右端に 18×18px の + ボタン（SVG アイコン）を追加。`e.stopPropagation()` でペイン onMouseDown 伝播を抑えつつクリックで `promptAndInsertFiles(id)` を発火。ホバーで `buttonHover` 色に切替
- **App.tsx**: capture phase の keydown に Cmd+O ハンドラを追加。IME 中は既存ガードでスキップ (src/renderer/App.tsx:128-136)
- **ShortcutsModal.tsx**: Terminal Management カテゴリに `⌘ O — ファイルを選択してパスを挿入` を追記
- **test/setup.ts**: `window.api.dialog` モックに `selectFiles` を追加（既存テスト互換のため）
- **insertFiles.test.ts（新規）**: `formatPaths` 5 ケース（通常/スペース/埋め込みクオート/複数連結/空配列）+ `promptAndInsertFiles` 4 ケース（正常系/キャンセル/空選択/例外）の計 9 テスト追加、全 113 件グリーン
- **Known limitation**: preload は Electron プロセス起動時にロードされ HMR 非対応。dev 実行中に preload を変更した場合は `npm run dev` の再起動が必要（ユーザー確認済み）

### 2026-04-23 - Cmd+Backspace をカーソルから行頭までの削除に修正

#### 概要

Cmd+Backspace が「カーソルから行頭まで削除」ではなく「行全体削除」になっていた問題を修正。`App.tsx` の Cmd+Backspace ハンドラが Ctrl+E（行末へ移動）→ Ctrl+U（backward-kill-line）の2段送信を行っていたため、カーソル右側の文字も巻き込んで消去されていた。ShortcutsModal のドキュメント「カーソル位置から行頭まで削除」とも仕様が食い違っていた。

#### 変更点

- **App.tsx**: Cmd+Backspace ハンドラから `\x05`（Ctrl+E）送信を削除し、`\x15`（Ctrl+U）のみ送信するよう変更。コメントも実動作に合わせ「カーソル位置から行頭まで削除」へ更新 (src/renderer/App.tsx:121-129)

> 2026-04-25 ローリングアーカイブ: これ以前の 11 エントリは [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。
