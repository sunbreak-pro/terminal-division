# HISTORY.md - 変更履歴

### 2026-04-25 - セッション永続化（T2-7、レイアウトと CWD の復元）

#### 概要

アプリ再起動時に前回のペイン分割構成と各葉ペインの CWD を復元する機能を実装（T3-4 → T2-7 へ昇格）。レイアウト二分木（`nodes` + `rootId`）と各葉ペインの cwd のみを `userData/session-state.json` に永続化し、起動時に最初のウィンドウへ同期復元する。実行中プロセス・コマンド履歴・ウィンドウサイズ・multi-window はスコープ外。検証失敗（version 不一致 / ノード数超過 / ツリー整合性違反）時はサイレントフォールバックで単一ペイン起動。React マウント前に `await window.api.session.getRestoreData()` で同期取得し、`terminalStore.hydrateLayout()` / `terminalMetaStore.hydrateMetas()` でストアを差し替えるため、TerminalPane が PTY を生成するときには既に保存 CWD がメタストアに乗っており、追加の配線なしで復元 PTY が正しい CWD で起動する。

#### 変更点

- **新規ファイル (Main)**: `src/main/types/session-state.ts`（DTO: `SerializedLayout` / `SerializedNode` / `SerializedMeta`、`SESSION_STATE_VERSION=1`、`MAX_NODES=11`）/ `src/main/session-state.ts`（`SessionStateManager` シングルトン、250ms debounce、検証ロジック: version / ノード数 / rootId / parent-children 整合 / サイクル / 孤立ノード / direction / 葉数 ≤ 6、metas は葉のみに絞り込み）
- **新規ファイル (Renderer)**: `services/sessionRestore.ts`（`serializeCurrentSession` / `deserializeLayout` / `restoreSession`、防衛的な再検証）/ `services/sessionPersist.ts`（store 購読 + 200ms debounced IPC 送信、レイアウト構造変化と CWD 変化のみ検出、同一スナップショット抑制）
- **既存編集 (Main)**: `ipc-handlers.ts` に `session:getRestoreData` (handle、最初の 1 回のみ返却、`sessionRestoreConsumed` フラグ管理) / `session:save` / `session:clear` を追加。`window-manager.ts` は変更なし（initial 単一ウィンドウへの配線は invoke 方式で renderer 側に集約）
- **既存編集 (Preload)**: `window.api.session.{ save, clear, getRestoreData }` を公開。`getRestoreData` は `Promise<SerializedLayout | null>`（buffer + on(...) push 方式は React マウント前のレースを誘発するため invoke ベースに統一）
- **既存編集 (Renderer Stores)**: `terminalStore.hydrateLayout()` を追加（rootId 存在 / 葉数 ≤ 6 / activeTerminalId フォールバック）。`terminalMetaStore.hydrateMetas()` を追加（initMeta の上書き禁止ガードを尊重しつつ復元時のみ既存メタ置換可能）
- **既存編集 (Renderer Entry)**: `main.tsx` で `await window.api.session.getRestoreData()` → `restoreSession()` を React マウント前に同期実行。`App.tsx` の `useEffect` で `startSessionPersist()` を購読開始
- **新規テスト**: `main/__tests__/session-state.test.ts`（13 件、検証の正常系 + 各破損パターン）/ `renderer/services/__tests__/sessionRestore.test.ts`（11 件、serialize / deserialize / round-trip / restoreSession）。`stores/__tests__/terminalStore.test.ts` に `hydrateLayout` 4 件追加。合計 17 ファイル / 226 件グリーン
- **設計判断**:
  - 復元データの取得は push (webContents.send + buffer) ではなく pull (ipcMain.handle + invoke) にすることで「main.tsx より IPC 受信が遅れる race」を構造的に解消
  - 保存トリガは「レイアウト構造変化」と「CWD 変化」のみ。フォーカス切替や processName 更新では IPC を起こさない（直前スナップショットとの JSON 文字列比較で重複保存も抑制）
  - debounce は renderer 側 200ms + Main 側 250ms の二段（IPC 回数とファイル I/O 回数の両方を抑制）
  - multi-window はスコープ外。`sessionRestoreConsumed` フラグで最初の getRestoreData 呼び出しだけが復元データを返す
  - スキーマバージョニングを v1 から導入し、将来の互換性破壊を `version !== 1` で全体破棄に倒す
  - CWD が起動時に存在しないケースは PTY 側の HOME フォールバックに委ね、レイアウト構造は維持
- **ドキュメント更新**: `CLAUDE.md` §3.7 セッション永続化節を新設、Tier Map の T3-4 を T2-7 へ昇格。`docs/requirements/tier-2-supporting.md` に T2-7 の Acceptance Criteria を追加。`docs/requirements/tier-3-experimental.md` から T3-4 を削除し T3-5 を T3-4 に繰上げ

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

> 2026-04-25 ローリングアーカイブ: これ以前の 18 エントリは [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。
