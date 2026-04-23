# HISTORY.md - 変更履歴

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

### 2026-04-23 - Shell integration を userData 配下へ永続化 + Electron バイナリ復旧

#### 概要

シェル統合用一時ファイル（`.zshenv` / `.zshrc` / `.bashrc`）の配置先を `os.tmpdir()/terminal-division-shell-<pid>` から `app.getPath("userData")/shell-integration` に変更し、macOS の tmp クリーンアップによる消失で OSC 7770（プロンプトドット）や OSC 7（CWD 追跡）が動かなくなる問題を解消。併せて `npm run dev` 起動時に Electron バイナリ欠落で `ENOENT` 終了する環境問題を `node node_modules/electron/install.js` の再実行で復旧した。

#### 変更点

- **shell-integration.ts**: 統合ディレクトリを `app.getPath("userData")/shell-integration` に変更し、Electron app モジュールを import
- **shell-integration.ts**: `getOrCreateIntegrationDir` に `fs.existsSync(integrationDir)` チェックを追加。macOS が裏でディレクトリを削除した場合も整合的に再生成する
- **環境復旧**: `node_modules/electron/dist/Electron.app` が削除されていたため install.js を再実行してバイナリを再ダウンロード（コード変更なし、環境修復のみ）

### 2026-04-23 - ペイン切替時の最下部フォーカス + 画面外ドットの sticky 化修正

#### 概要

長時間のコマンド実行後にペイン切替すると上部/中間にフォーカスが残りプロンプトが見えない問題と、コマンド完了ドット（緑/赤）がスクロールアウトすると左端に貼り付く問題を修正した。根本原因は、xterm.js の decoration 描画ロジックが画面外マーカーに `display:"none"` をセットしてから `onRender` を発火する挙動に対し、OSC 7770 ハンドラの onRender コールバックが無条件で `display:"flex"` に上書きしていたこと。過去コマンドの orphan decoration が最終可視時の top 値のまま左端(x=0)に積層し、パネルが大きく見えたり内容が二重に見える副作用も誘発していた。

#### 変更点

- **terminalManager.ts**: OSC 7770 D ハンドラの `decoration.onRender` で `element.style.display === "none"` の場合に早期 return。xterm が画面外マーカーを hide する挙動を尊重する
- **terminalManager.ts**: `scrollToBottom(id)` を新設。registry 欠落時は no-op
- **TerminalPane.tsx**: `[isActive, id]` useEffect で active になった瞬間に `focus()` に加えて `scrollToBottom()` を呼び出し。active のまま再実行されることはないため、スクロール閲覧中に意図しないジャンプは起きない
- **terminalManager.test.ts**: `scrollToBottom` の unit test 追加 + Bug 3 回帰テスト（registerOscHandler の calls から OSC 7770 ハンドラを捕捉し、画面内 "block" / 画面外 "none" 両ケースで onRender の振る舞いを検証）を追加
- **TerminalPane.test.tsx**: mock に `scrollToBottom` を追加、既存の `paneNumber` 必須プロパティ型エラーを一括修正、`querySelector<HTMLElement>` で `.style` アクセス型を明示
- **test/setup.ts**: `window.api` モックに `window.getInitialCwd` / `system.getHomeDir` / `recentDirs.add` / `shell.openExternal` を補完し、既存テストの未モック欠損を解消

> 2026-04-23 ローリングアーカイブ: これ以前の 9 エントリは [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。
