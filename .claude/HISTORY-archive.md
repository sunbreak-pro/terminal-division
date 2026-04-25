# HISTORY-archive.md - 変更履歴アーカイブ

HISTORY.md のローリングアーカイブ。エントリが 5 件を超えた際に古いものをここへ移動する（降順、最新が先頭）。

### 2026-04-25 - サイドバー UX 強化（タブ視認性 / D&D / Undo・Redo / パスコピー）

#### 概要

初版サイドバーに対する 4 系統の UX 強化:

1. タブにフォルダアイコン + 縦余白 (min-height 34px、bottom-border) を追加し視認性を向上
2. ドラッグ&ドロップを実装(ツリー内移動 / 外部 Finder からのコピー / ツリーから外部アプリへ OS ネイティブ drag / ツリーからターミナルへパス挿入)
3. 削除・名称変更・移動の Undo/Redo を 50 件のセッション内スタックで実装、サイドバー上部にアイコンツールバー配置
4. ファイル/ディレクトリ右クリックメニューの最上段に相対パス・フルパスコピーを追加

#### 変更点

- **新規 IPC**: `fs:trashWithTracking`(`~/.Trash` を diff で追跡し復元用パス取得) / `fs:restoreFromTrash` / `fs:movePath`(直接移動、ダイアログなし) / `fs:copyPath`(再帰コピー、衝突時 ` copy`/` copy N` suffix) / `dnd:startDrag`(`webContents.startDrag` + `app.getFileIcon`)
- **新規ファイル(renderer)**: `stores/fileOpsHistoryStore.ts`(50 件 undo/redo スタック) / `services/fileOpsService.ts`(performRename/Trash/Move/Copy + undoLast/redoLast) / `components/Sidebar/UndoRedoToolbar.tsx`
- **既存編集(renderer)**:
  - `Sidebar.tsx` 上部に `UndoRedoToolbar` をマウント
  - `SidebarTabs.tsx` にフォルダアイコン + 余白 + 下線
  - `TreeNode.tsx` に draggable + dragstart で `dnd.startDrag`(OS ネイティブ drag) + 独自 MIME `application/x-td-path` 埋込み + ディレクトリへの dragover/drop(内部=移動、外部=コピー)
  - `DirectoryTree.tsx` のルートコンテナにも drop 受け、メニュー最上段にパスコピー
  - `TerminalPane.tsx` に dragover/drop で `formatPaths` 経由でパス挿入
- **既存編集(preload)**: `webUtils.getPathForFile` 公開、`fs.*` に新 IPC 追加、`dnd.startDrag` 追加
- **設計判断**:
  - D&D の挙動 → ツリー内=常に移動、外部 Finder→ツリー=常にコピー(原本破壊回避)、ツリー→ターミナル=パス挿入
  - Undo の Cmd+Z はターミナル既存と衝突するためアイコンクリックのみ
  - 削除 Undo はゴミ箱内追跡(`~/.Trash` 差分検出)、外部ボリュームで追跡失敗した場合はトースト通知し undo 不可
  - copy 操作は undo 履歴に積まない(逆操作=削除は破壊的すぎる)
  - 編集中(リネーム入力中)は draggable を無効化

### 2026-04-25 - 左サイドバー追加（CWD 別タブ + ディレクトリツリー + ファイル操作）

#### 概要

Header の Title 右隣にトグルアイコンを追加し、開閉可能な左サイドバーを実装。サイドバー上部に各ペインの CWD 別タブを縦スタックで並べ（同 CWD のペインは 1 タブに集約、basename 衝突時は `name (parent)` 形式へ自動書換、tooltip でフルパス表示）、下にツリーを描画する。ツリーは lazy 展開（クリックで `fs:readDir` を発火）し、展開されたノードのみ `chokidar` (`depth: 0`) で参照カウント付きで watch、折りたたみ時に解放する。隠しファイル / `node_modules` も除外せず全表示。アクティブペインとタブは双方向に同期し、集約タブクリック時は所属ペインのうち直近アクティブだったペインをアクティブ化する（`terminalMetaStore` に `lastActiveAt` 単調増加カウンタを追加）。ファイルは右クリック / ダブルクリックでコンテキストメニュー（削除＝ゴミ箱 / 移動＝ネイティブダイアログ / 名称変更＝インライン編集 / そのディレクトリに移動 / VSCode で開く）、タブは右クリックで相対パス・フルパスのコピー。サイドバー幅のみ `userData/sidebar-state.json` に永続化、開閉状態と展開状態と選択タブはセッション内のみ。

#### 変更点

- **新規 IPC**: `fs:readDir` / `fs:watch` / `fs:unwatch` / `fs:rename` / `fs:moveToDir` / `fs:trash` / `fs:openInVSCode` / `sidebar:getWidth` / `sidebar:setWidth` を `ipc-handlers.ts` に追加。`fs:change` を main → renderer ブロードキャスト
- **新規ファイル（main）**: `file-system-handler.ts`（chokidar 統合・参照カウント watcher・rename / moveToDir / trash / VSCode spawn）、`sidebar-state.ts`（幅の debounced 永続化、180–600px clamp）
- **新規ファイル（renderer）**: `stores/sidebarStore.ts` / `stores/fileTreeStore.ts` / `utils/labelCollision.ts` + テスト（19 件）/ `components/Sidebar/` 配下に Sidebar / SidebarTabs / DirectoryTree / TreeNode / ResizeHandle / ContextMenu / ErrorToast / icons の 8 コンポーネント
- **既存編集**: `App.tsx` レイアウトを Header の下に flex row（Sidebar + 既存 SplitContainer）化、`Header.tsx` にサイドバートグル追加、`terminalMetaStore.ts` に `lastActiveAt` / `createdAt` / `touchActive` 追加、`terminalStore.setActiveTerminal` から `touchActive` を自動連動、`preload/index.ts` に `window.api.fs.*` / `window.api.sidebar.*` を公開、`electron.vite.config.ts` の main rollup external に `chokidar` / `fsevents` を追加
- **依存追加**: `chokidar@^3.6.0`
- **設計判断**: ペインの右クリックメニューは存在しない / VSCode CLI 不在時はトーストで案内 / 移動先選択は OS ネイティブダイアログ / インライン編集の選択範囲は basename の拡張子前まで自動選択

### 2026-04-25 - Cmd+W で閉じるボタンの border shorthand と borderColor 混在による React 警告を修正

#### 概要

Cmd+W で最後から 2 つ目のペインを閉じて `terminalCount === 1` になり「閉じる」ボタンが disabled に切り替わる際、React が「Removing a style property during rerender (borderColor) when a conflicting property is set (border)」警告を出していた問題を修正。`buttonStyle` が `border` shorthand を持つ一方、有効時の `closeButtonStyle` だけが `borderColor` 単独プロパティを上書きしていたため、disabled 切替時に `borderColor` を消そうとしても shorthand `border` が残る矛盾が発生していた。

#### 変更点

- **Header.tsx (closeButtonStyle)**: `borderColor: theme.colors.danger` 単独設定を `border: '1px solid ${theme.colors.danger}'` shorthand に統一 (src/renderer/components/Header.tsx:104-110)
- **Header.tsx (handleCloseButtonEnter / handleCloseButtonLeave)**: 直接 DOM 操作の `e.currentTarget.style.borderColor = ...` を `e.currentTarget.style.border = '1px solid ...'` に統一し、`buttonStyle` 側の shorthand と混在しないよう揃えた (src/renderer/components/Header.tsx:128-146)

### 2026-04-25 - vi-mode 環境で Cmd+←/→/K が ^A/^E/^K として echo されるバグを修正

#### 概要

ユーザの `$EDITOR=vim` / `$VISUAL=vim` 設定により zsh の main keymap が `viins` になり、`^A` / `^E` / `^K` が `self-insert` 扱い（reverse video の `\e[7m^A\e[27m` literal echo）、`\eb` / `\ef` / `\ed` が `undefined-key` になっていた。前回 (6f10234) のフォールバックタイマ式 shell readiness 判定にも race（zsh 起動 2.66 秒 vs 3 秒タイマ）が残っていたため、(1) shell-integration `.zshrc` で Terminal Division ショートカットが送る制御コード群を `bindkey` で readline 互換にバインド、(2) フォールバックタイマを撤去し OSC 7770;A 受信のみで `shellReady` 判定、(3) OSC 7770;A の送信を `precmd` から `zle-line-init` に移して zle が raw mode を確立した後にだけ発火させる、の 3 段階で根本修正。

#### 変更点

- **shell-integration.ts (createZshrc)**: `bindkey '^A' beginning-of-line` / `'^E' end-of-line` / `'^K' kill-line` / `'^U' backward-kill-line` / `'^W' backward-kill-word` / `'\eb' backward-word` / `'\ef' forward-word` / `'\ed' kill-word` を user `.zshrc` source 後に注入。vi モード派ユーザの hjkl 等は壊さず、Terminal Division ショートカットで送る制御コードだけ readline 互換に強制
- **shell-integration.ts (createZshrc)**: OSC 7770;A 送信を `__td_precmd` から `__td_zle_line_init` (`zle -N zle-line-init __td_zle_line_init`) に移動。`precmd` は zsh が prompt を描画する _前_ (= zle 起動・raw mode 切替前) に走るため、`shellReady=true` 時点でまだ canonical mode + echoctl のままで `\x01` が `^A` として echo される race を解消
- **terminalManager.ts**: `SHELL_READY_FALLBACK_MS` 定数 / `TerminalInstance.shellReadyTimer` フィールド / `getOrCreate()` 内 `setTimeout` 設置 / `destroy()` のタイマクリア / OSC 7770;A ハンドラの `clearTimeout` を全削除。`shellReady` は OSC 7770;A 受信のみで true。シェル統合 OSC が来ない構成（fish 等）では永久に false となるが、誤った ^X echo よりは安全
- **terminalManager.ts**: `isShellReady` の JSDoc を「OSC 7770;A 受信のみ」に更新
- **terminalManager.test.ts**: 旧 `isShellReady becomes true after the fallback timer fires` テストを「フォールバックなしで 60s 経っても false」「OSC 7770 ハンドラ "A" 発火で true」の 2 ケースに置換。130 / 130 グリーン
- **デバッグセッション**: 真因特定は実環境ログ（`PTY OUTPUT contains ^A/^E/^K (canonical mode echo!): "[7m^A[27m"`）と PTY 内 `bindkey '^A'` 出力（`"^A" self-insert`、main keymap=`viins`）に依拠。subshell の `/bin/zsh -i -c` テストでは `EDITOR` 未設定で emacs に落ち気付けなかった点を反省として記録

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

### 2026-04-22 - .claude/ 構造を project-setter 準拠に大規模再編

#### 概要

`.claude/` ディレクトリを archive の project-setter スキルに準拠した Software 標準構造に再編した。`bugs/` + `solutions/` を Root Cause + 再発防止知見中心の `docs/known-issues/` に統合し、ADR ベースの `specs/` を廃止して `docs/vision/` + `docs/requirements/` に分離。CLAUDE.md を 9 章構成（Meta / Vision / Platform / Architecture / Data Model / AI / Coding Standards / Workflows / Feature Tier / Document System）に書き直した。

#### 変更点

- **CLAUDE.md（全面書き換え）**: 88 → 294 行、400 行制限内。9 章構成に再編し、旧 `## Task Tracking` 等の古い節を廃止。コーディング規約・デバッグ要点・Feature Tier Map を追加
- **docs/vision/（新規）**: `README.md`、`core.md`（Value Proposition / Target User / Non-Goals）、`coding-principles.md`（設計原則 — registry モジュールスコープ / IPC 最小公開 / 二分木レイアウト / IME textarea 直結 / PATH 多層フォールバック / bracket paste / 言語規約 / 小さく保つ）
- **docs/requirements/（新規）**: `README.md`、Tier 1 / Tier 2 / Tier 3 を Acceptance Criteria 付きで整理
- **docs/known-issues/（新規）**: `INDEX.md`、`_TEMPLATE.md`、`001-packaged-app-japanese-garbled.md`（旧 bugs + solutions 統合）
- **docs/code-explanation/（新設）**: 既存 `docs/01-05.md`（Electron 基礎 / アーキテクチャ / データフロー / レイアウト / 高度機能）を `git mv` で移動し `README.md` を追加
- **archive/（新規）**: `README.md` のみ。完了済みプランの保管場所として機能定義
- **skills/（新規）**: task-tracker / session-verifier / code-plan-editor / git-workflow / debug-strategy / code-review / efficient-codebase-nav / code-refactoring の 8 スキルを `~/dev/Claude/skill-lib/global/` からシンボリックリンク
- **削除**: `.claude/bugs/`（2 ファイル）、`.claude/solutions/`（3 ファイル）、`.claude/specs/`（3 ファイル = templates の ADR・feature-spec 含む）を `git rm -r`
- **MEMORY.md / settings.local.json**: 既存維持

### 2026-03-15 - Dockメニュー最近ディレクトリ表示 + 分割時CWD継承

#### 概要

macOS Dockアイコン右クリックで「最近のディレクトリ」を表示し選択で新ウィンドウを開く機能と、ターミナル分割時に元ペインのCWDを新ペインに引き継ぐ機能を実装した。

#### 変更点

- **分割時CWD継承**: `terminalMetaStore.ts` の `initMeta` に既存チェック追加（上書き防止）、`terminalStore.ts` の `splitTerminal` で元ペインのCWDを新ペインのメタに事前設定
- **RecentDirectoryManager（新規）**: `recent-directories.ts` にJSON永続化、重複除去、ホームディレクトリ除外、最大10件、存在チェック、変更通知コールバックを実装
- **Dockメニュー動的構築**: `dock-menu.ts` を「新しいウィンドウ」＋セパレーター＋最近のディレクトリセクションに拡張、`~`短縮パス表示、onChange自動再構築
- **ウィンドウ初期CWD対応**: `window-manager.ts` に `initialCwd` パラメータ追加、`did-finish-load` で `window:initialCwd` IPC送信
- **IPCハンドラー拡張**: `ipc-handlers.ts` に `recentDirs:add` ハンドラー追加、`window:create` に `initialCwd` 引数追加
- **Preload API拡張**: `preload/index.ts` に `window.getInitialCwd()`（バッファ方式）と `recentDirs.add()` を追加
- **OSC 7通知**: `terminalManager.ts` のOSC 7ハンドラーで `recentDirs.add` 呼び出し追加
- **TerminalPane CWD優先順位**: メタストア（分割時） > windowInitialCwd（Dockメニュー） > undefined の3段階フォールバック

### 2026-03-15 - code-plan-editor と Plan mode の統合

#### 概要

code-plan-editor スキルに Pre-Plan（Workflow 0）と Post-Plan（Workflow 1.5）を追加し、Plan mode との統合フローを構築した。テンプレート外部化、ルールファイル作成、SKILL_INDEX 更新を実施。

#### 変更点

- **plan-template.md（新規）**: 計画書テンプレート定義 + 記入ガイド + Plan mode 出力 → テンプレート変換マッピング表を `references/` に作成
- **plan-mode-quality.md（新規）**: `~/.claude/rules/` に Plan mode 出力フォーマット指示とワークフローチェイン案内を作成（36行）
- **SKILL.md（拡張）**: Workflow 0（既存計画スキャン、MEMORY.md確認、テンプレート注入）と Workflow 1.5（Plan mode出力検出、テンプレート変換、保存、task-tracker連携提案）を追加。Rulesセクションも拡張
- **SKILL_INDEX.md（更新）**: code-plan-editor の説明を Plan mode 統合に反映

### 2026-03-15 - カスタムアイコンへの置き換え

#### 概要

アプリアイコンを `terminal-division-icon.png` からImageMagick + iconutilで `.icns` に変換し、`resources/icon.icns` として配置した。`electron-builder.yml` は既に同パスを参照済みのため設定変更不要。

#### 変更点

- **resources/icon.icns**: `terminal-division-icon.png`（1024x1024 RGBA PNG）から各サイズ（16〜1024）を生成し、icns形式に変換して配置

### 2026-03-15 - 画面真っ暗バグの修正（onFocus APIエラー）

#### 概要

`npm run dev` でアプリ起動時にウィンドウが完全に黒一色になるバグを修正。前回のフォーカス同期修正で追加した `terminal.onFocus()` が `@xterm/xterm@5.5.0` に存在しないAPIであり、`getOrCreate()` 内で例外が発生してReactコンポーネントがクラッシュしていた。

#### 変更点

- **terminalManager.ts**: `terminal.onFocus()` を削除し、`textarea.addEventListener('focus', ...)` に変更。`registerCompositionListeners` → `registerTerminalListeners` にリネームしてフォーカスリスナーを統合
- **terminalManager.test.ts**: MockTerminal から存在しない `onFocus` モックを削除

### 2026-03-15 - フォーカス同期バグ修正

#### 概要

ペイン内部をクリックしてもオレンジ枠線（activeTerminalId）が追従しないバグを修正。xterm.jsの`onFocus`イベントでストアを同期し、`onClick`を`onMouseDown`に変更して微小ドラッグ時の未発火問題も解消した。

#### 変更点

- **terminalManager.ts**: `TerminalCallbacks`に`onFocus`コールバックを追加し、`terminal.onFocus()`リスナーを登録
- **TerminalPane.tsx**: `onFocus`コールバックで`setActiveTerminal`を呼ぶよう変更、`onClick`→`onMouseDown`に変更、ハンドラから`terminalManager.focus()`呼び出しを削除
- **テスト更新**: `terminalManager.test.ts`と`TerminalPane.test.tsx`を新しいインターフェースに合わせて更新

### 2026-03-15 - テスト失敗修正: モック不足の補完

#### 概要

17件のテスト失敗（themeStore: 7件、terminalManager: 9件、TerminalPane: 1件）をすべてモック不足の補完で修正し、101テスト全通過を達成した。

#### 変更点

- **グローバルテストセットアップ**: `setup.ts` に `window.api.theme` モック（`notifyChanged`, `onSync`）を追加
- **terminalManager.test.ts**: MockTerminalに `parser`, `registerMarker`, `registerDecoration`, `write`, `options` を追加。ptyモックに `onProcessName`/`onShellName` を追加。`terminalMetaStore` モックを追加
- **TerminalPane.test.tsx**: `terminalMetaStore` モックを追加。`pty.create` アサーションを2引数（id, initialCwd）に修正

### 2026-03-15 - パッケージ版PATH解決の多層フォールバック修正

#### 概要

パッケージ化されたElectronアプリをFinderから起動した際に `npm`, `brew`, `claude` 等のコマンドが見つからなくなる問題を、多層フォールバックPATH解決で修正した。

#### 変更点

- **必須環境変数保証**: `ensureEssentialEnvVars()` で HOME/USER/SHELL/LANG が未設定時に補完
- **Strategy 1改善**: `-ilc` → `-lc` (非インタラクティブ化)、`echo` → `printf`、`stdin: "ignore"`、timeout 5秒、stderr分離、診断ログ強化
- **Strategy 2追加**: `/usr/libexec/path_helper -s` でシステムPATH取得（シェル非依存）
- **Strategy 3追加**: Homebrew/nvm/Volta/asdf/cargo/deno/bun等のwell-known pathsをファイルシステムでプローブ（nvmは最新バージョン自動検出）
- **PATH検証**: `validatePath()` で取得PATHの妥当性チェック（/usr/bin含有、3エントリ以上、4096文字未満）
- **統合ロジック**: Strategy 1成功→即return、失敗→Strategy 2+3マージ、全失敗→process.env.PATHフォールバック

### 2026-03-15 - 未使用コード削除 + コード品質修正 + テスト修正リファクタリング

#### 概要

コードベース全体から未使用コード・不要なexport・重複関数を削除し、コード品質の改善とテストのAPI不一致を修正した。

#### 変更点

- **未使用ファイル削除**: `throttle.ts` を削除
- **未使用関数削除**: `rafDebounce`, `getResolvedPath()`, `getAllWindows()` を削除
- **未使用型削除**: `PtyDataCallback`, `PtyExitCallback` を `preload/index.ts` から削除
- **後方互換export削除**: `theme.ts` の `theme`, `xtermTheme` export を削除
- **未使用セレクタ削除**: `useCurrentThemeId` を `themeStore.ts` から削除
- **未使用アクション削除**: `getNode` を `terminalStore.ts` から削除（interface, 実装, selector, テスト, モック全て）
- **重複関数統合**: `isTerminalPane` を `layoutUtils.ts` に統合し、`terminalStore.ts` からはimportに変更
- **コード品質修正**: `pty-manager.ts` の `writeChunked` fire-and-forgetに `.catch()` 追加
- **テスト書き直し**: `pty-manager.test.ts` を現在のマルチウィンドウAPIに合わせて全面書き直し（27テスト全通過）
