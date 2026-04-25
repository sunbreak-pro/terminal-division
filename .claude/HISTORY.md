# HISTORY.md - 変更履歴

### 2026-04-25 - Cmd+F 検索オーバーレイ + ペイン別パス履歴 + サイドバー再読み込み

#### 概要

3 機能を 1 PR で追加: (1) ペインごとの Cmd+F テキスト検索（`@xterm/addon-search` を `terminalManager` に統合し、アクティブペインの右上に浮かぶオーバーレイ。Esc 閉じる / Enter 次 / Shift+Enter 前 / Tab で Path 履歴へ切替）。(2) PTY 出力からペイン別に絶対 (`/...`, `~/...`) と相対 (`./...`, `<word>/<word>`) のパスを抽出し最大 200 件の履歴を蓄積。Path タブで絞り込み、Enter でターミナルにシェルエスケープ付き挿入、⌘C でコピー。(3) サイドバーのディレクトリツリー再読み込み機能。`UndoRedoToolbar` に Refresh アイコン、選択タブ切替時に自動 refresh、Cmd+R ショートカット（dev ビルドの page reload を抑止するため常時 preventDefault）。

#### 変更点

- **新規依存**: `@xterm/addon-search`
- **新規ファイル (renderer)**:
  - `components/TerminalSearchOverlay.tsx`: Cmd+F のオーバーレイ UI。Text / Path 履歴 のタブ切替、キーボード操作（Esc/Enter/Shift+Enter/Tab/↑↓/⌘C）
  - `stores/pathHistoryStore.ts`: ペイン別パス履歴（最大 200、末尾スラッシュ正規化、再観測で count++、`removePane`/`clearPane` でクリーンアップ）
  - `stores/terminalSearchStore.ts`: 検索オーバーレイの開閉状態（同時に 1 ペインのみ）
- **既存編集 (renderer)**:
  - `services/terminalManager.ts`: `SearchAddon` ロード、`findNext` / `findPrevious` / `clearSearchDecorations` を export。`pty:onData` で ALT screen 以外なら `feedPathHistory` に流す。ANSI escape を除去し改行ごとに `extractPaths` でパスを抽出（持ち越しバッファ上限 8KB / 行長 4KB ガード）。`destroy()` で `pathHistoryStore.removePane` と `pathBuffers.delete` を追加
  - `components/TerminalPane.tsx`: `useSearchOpenForPane` で `TerminalSearchOverlay` を条件レンダリング
  - `App.tsx`: 既存 capture-phase keydown ハンドラに Cmd+F（toggle search）と Cmd+R（refresh sidebar、常時 preventDefault）を追加
  - `stores/fileTreeStore.ts`: `refreshAllExpanded(rootPath)` を追加。`sidebarStore.expandedPaths` から当該ルート配下の展開中パスを集め `Promise.all` で並列再ロード
  - `components/Sidebar/Sidebar.tsx`: `selectedTabCwd` 変更時に `refreshAllExpanded` を発火（タブ切替時の自動再読み込み）
  - `components/Sidebar/UndoRedoToolbar.tsx`: Refresh ボタン追加（spinner state は `isRefreshing` で disabled）
  - `components/Sidebar/icons.tsx`: `RefreshIcon` を追加
  - `components/ShortcutsModal.tsx`: `⌘ F`（ペイン内検索 / パス履歴）と `⌘ R`（ディレクトリツリー再読み込み）を追記
- **新規テスト**: `pathHistoryStore.test.ts`（7 件）/ `terminalSearchStore.test.ts`（5 件）/ `fileTreeStore.test.ts`（3 件）。190 / 190 グリーン
- **設計判断**:
  - パス挿入は既存 D&D と同じ直接 `pty.write(formatPaths(...))` パターンに揃える（Cmd+Z 行 Undo の対象外）
  - Cmd+R はサイドバー閉時にも常に preventDefault（dev で webContents.reload を防ぐため）
  - 相対パス抽出は CWD が判明している時のみ。`http://`/`https://` は除外
  - パス履歴の重複は末尾スラッシュ正規化キーで吸収。同一 raw 再観測時は count++ + lastSeenAt 更新
  - 検索オーバーレイ開閉は同時 1 ペインに限定し、複数オーバーレイ並列を許さない（フォーカス競合を防ぐ）
  - 既存 chokidar watch は維持。手動 refresh は chokidar が unwatch 中（タブ切替で release）に取り逃した変更を補完する位置付け

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

> 2026-04-25 ローリングアーカイブ: これ以前の 15 エントリは [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。
