# HISTORY.md - 変更履歴

### 2026-04-25 - サイドバーの「相対パスをコピー」をアクティブターミナルの CWD 起点に修正

#### 概要

サイドバーで右クリック → 「相対パスをコピー」を実行すると、ホームディレクトリを `~` に置換するだけで実質フルパスと変わらない問題を修正。アクティブなターミナルの CWD を起点とした POSIX 相対パス（`./foo` や `../bar/baz`）を返すように変更。シェル文脈で意味のある相対パスとなり、コピー結果をそのままコマンドに貼り付けて利用できる。

#### 変更点

- **新規ユーティリティ**: `utils/labelCollision.ts` に `terminalRelativePath(absPath, baseCwd)` を追加。同一ディレクトリは `.`、子孫は `foo/bar`、祖先・兄弟は `../...` を生成。trailing slash 正規化と Windows `\` → `/` 変換を内包
- **DirectoryTree.tsx**: `useTerminalMetaStore` セレクタでアクティブターミナルの CWD を購読（プリミティブ返却で再レンダリング抑制）。コンテキストメニューの「相対パスをコピー」は活ターミナル CWD 起点で算出し、CWD 不明時のみ従来の `homeRelativePath` にフォールバック
- **テスト追加**: `labelCollision.test.ts` に 6 ケース（同一・子孫・祖先・兄弟・trailing slash 正規化・空 base）。15 ファイル / 198 件グリーン
- **設計判断**: 「相対パス」の意味をシェル文脈に揃える（ターミナルへ貼り付けて意味が通る形）。ホーム起点の `~/...` 形式は CWD 不明時のフォールバックとして残置し、ユーザー視点の不規則性を最小化

### 2026-04-25 - Sidebar Cmd+Z/Cmd+Shift+Z/Cmd+. ショートカット + Claude 入力欄での Cmd+Z 暴発防止

#### 概要

3 系統の改善を 1 まとめで実装: (1) サイドバーの Undo/Redo（rename / move / trash）にキーボードショートカット `Cmd+Z` / `Cmd+Shift+Z` を割り当て。`sidebarStore.lastInteractedArea` を導入し、最後にマウスダウン or フォーカスしたエリア（sidebar / terminal）でディスパッチ先を切り替える。`<aside>` の `onMouseDownCapture` で sidebar、`TerminalPane` の `onMouseDown` と xterm textarea の `focus` で terminal をマーク。rename input にフォーカス中はブラウザ標準のテキスト Undo を尊重するため `isEditableTarget` ガードを通過させる。(2) サイドバーの開閉トグルに `Cmd+.` を追加（`useSidebarStore.toggleOpen` 直結）。(3) Claude Code（Ink TUI）など readline 非対応プロセスが前面にいるときの `Cmd+Z` で `\x05\x15` が入力欄に流れて壊れる問題の根本対策として、`terminalManager.isReadlineActive(id)` ヘルパを追加し前面プロセス名 = シェル名のときだけ `undo()` / `redo()` を発火させる no-op ガードを実装。

#### 変更点

- **新規 store フィールド (renderer)**: `sidebarStore.ts` に `lastInteractedArea: 'sidebar' | 'terminal'` と `setLastInteractedArea` を追加。同値 set で再生成しない冪等チェック付き
- **App.tsx ショートカット拡張**:
  - `Cmd+Z` ハンドラを書き換え。`isEditableTarget(target)` で input/textarea（xterm-helper-textarea を除く）/ contentEditable はパススルー
  - `lastInteractedArea === 'sidebar'` かつ `useFileOpsHistoryStore.undoStack.length > 0` のとき `undoLast()`、それ以外は `terminalManager.undo(activeTerminalId)`。`Cmd+Shift+Z` も同様に redo を分岐
  - `Cmd+.` ハンドラを新規追加し `useSidebarStore.toggleOpen()` を直接呼び出し
  - 新規ヘルパ `isEditableTarget(target)` を export せず module scope に追加
- **Sidebar.tsx**: `<aside>` に `data-sidebar-root="true"` と `onMouseDownCapture={() => setLastInteractedArea("sidebar")}` を付与
- **TerminalPane.tsx**: `handleMouseDown` と `onFocus` callback で `setLastInteractedArea("terminal")` をマーク
- **terminalManager.ts**: `isReadlineActive(id)` ヘルパを新規追加。`metas.processName === metas.shellName` をチェック。`processName === null` 時は `shellName` 確定済みなら true（起動直後の zsh プロンプト待ち状態を救済）。`undo()` / `redo()` の冒頭に `if (!isReadlineActive(id)) return false;` ガードを挿入
- **ShortcutsModal.tsx**: Sidebar セクションに `⌘ .` / `⌘ Z` / `⌘ ⇧ Z` を追記。`<div key={shortcut.keys}>` の重複を `${category.title}:${shortcut.keys}` 複合キーに変更（Sidebar / Line Editing で `⌘ Z` が重複するため）
- **新規/更新テスト**:
  - `terminalManager.test.ts`: `__testMetas` 永続化 Map で `setShellName` / `setProcessName` を実反映するモックに置換。`createReadyInstance` で `shellName=processName="zsh"` を設定。`returns false when foreground process is not the shell` ケースを追加
  - `sidebarStore.test.ts`: `beforeEach` 初期化に `lastInteractedArea: "terminal"` を補完。`setLastInteractedArea` の冪等性テストを 1 件追加
  - `ShortcutsModal.test.tsx`: `getByText("⌘ Z")` を `getAllByText` に変更（Sidebar / Line Editing 両方に登場）
- **設計判断**:
  - サイドバー Undo の SC は Cmd+Z 標準互換を優先し、focus context ではなく「最後にマウス操作したエリア」で振り分ける（DOM focus が body に逃げるケースが多いため）。rename input 中はブラウザ Undo を尊重
  - readline ガードは `processName === shellName` の単純比較。1 秒間隔ポーリングのため切替直後に数百 ms の race があるが、暴発より安全側
  - Shift+Enter で `\n` 受信時に履歴をリセットする既存挙動は据え置き。多行 zsh コマンドの Undo 改善は将来の OSC 133 シェル統合 (Tier 3-3) に委ねる

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

> 2026-04-25 ローリングアーカイブ: これ以前の 17 エントリは [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。
