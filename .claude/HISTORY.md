# HISTORY.md - 変更履歴

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

> 2026-04-25 ローリングアーカイブ: これ以前の 14 エントリは [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。
