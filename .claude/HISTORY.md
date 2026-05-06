# HISTORY.md - 変更履歴

### 2026-05-06 - VSCode 風 4 機能追加（Material アイコン / パス hover panel / ピン留めツリー / Git 連携）+ xterm 全角リンクずれ修正

#### 概要

ユーザー要望「VSCode の基本機能をトレース」した 4 機能（Git 連携 / 拡張子別ファイルアイコン / パス hover panel / ペインに紐付かない追加ツリー）を 1 セッションで実装。先行して報告された xterm 上の Markdown リンク左ずれ + ENOENT エラーポップアップも修正。Material Icon Theme は npm 公式 (MIT) を導入し Vite の `import.meta.glob` で 1238 個の SVG をアセット化（dev では絶対 glob が renderer root 解決で失敗するバグを発見、相対パスに修正）。Hover panel は xterm の `registerLinkProvider` の hover/leave コールバックを活用、文字列 offset → セル列マップで全角文字混在時の表示位置ずれを解消。ピン留めツリーは独自永続化 (`pinned-directories.json`) + `path-validator` の動的 allow リスト方式で HOME 外パスにも対応。Git 連携は `simple-git` を main プロセスで動かし、左サイドバーのタブ列末尾に「⎇ Git」モード切替を追加して同じ列内に統合（CWD タブと相互排他）。Status / branch list/switch/create/delete / stage / unstage / commit / push / pull / fetch / diff の全主要操作 + 縦リサイズ可能な Staged/変更セクションを実装。中盤で報告された 2 件のバグ（ピン留め失敗 = validatePath ホワイトリスト範囲外、Git「読み込み中…」永続化 = refresh の Promise.all 例外で loading 凍結）も同セッション内で根本修正。session-verifier 通過で 535/535 → 539/539 PASS、`npm run build` グリーン。

#### 変更点

- **新規 `src/renderer/utils/xtermLine.ts`**: `buildOffsetToColumnMap(line)` で文字列 offset → 1-based セル列マップを構築。継続セル (width=0) スキップ、全角文字を正しく 2 セル分カウント。`terminalManager.ts` の link provider が直接 `m.start + 1` を column に渡していた既知の制限（コメントに「ずれる可能性があるが許容」と明記済み）を解消
- **`src/renderer/services/markdownOpenService.ts`**: `result.error.startsWith("ENOENT")` を判定して `ファイルが見つかりません: <basename>` の簡潔 toast に切替。長い stat 文字列をユーザに見せない
- **`src/renderer/utils/markdownPath.ts`**: `findPaths(line)` を新規追加し `kind: "md" \| "path"` で md / 一般パスを統合検出。`findMarkdownPaths` は `findPaths` を kind フィルタする薄いラッパに（後方互換維持）。一般パス用 regex 追加（拡張子非限定、URL 範囲除外、末尾装飾文字 trim）
- **`src/renderer/services/terminalManager.ts`**: link provider を unified に書き換え、`hover` / `leave` / `activate` を全 dispatch。`TerminalCallbacks` に `onPathOpen` / `onPathHover` / `onPathLeave` を追加。`buildOffsetToColumnMap` を import して range.x を正確化
- **新規 `src/renderer/stores/pathHoverStore.ts`** + **`src/renderer/components/PathHoverTooltip.tsx`**: tooltip 状態を Zustand global シングルトンに集約（StrictMode race 回避）。`position: fixed` + `pointer-events: none` でターミナル操作を妨げない
- **`src/main/ipc-handlers.ts`**: `shell:openPath` IPC 追加（`shell.openPath` でファイル/ディレクトリを OS デフォルトハンドラに渡す）
- **新規 `material-icon-theme` (npm, MIT, v5.34.0)**: + **`src/renderer/utils/materialIconResolver.ts`**: `generateManifest()` を 1 度だけ実行、`import.meta.glob('../../../node_modules/material-icon-theme/icons/*.svg', { eager: true, query: '?url' })` で全 SVG をアセット化。`fileNames` 完全一致 → `fileExtensions` 最長一致 → `EXT_TO_LANGUAGE_ID` 経由 `languageIds` → デフォルトの順で解決
- **`src/renderer/components/Sidebar/icons.tsx`**: `FileTypeIcon` / `FolderTypeIcon` を新規追加（解決失敗時は既存 outline `FileIcon` / `FolderIcon` にフォールバック）。`DirectoryTree.tsx` / `TreeNode.tsx` / `SidebarTabs.tsx` の呼び出しを `name` 引数付きに置換
- **新規 `src/main/pinned-directories.ts`**: `pinned-directories.json` で永続化、最大 50 件、実在チェック付き。起動時 / add / remove で動的 allow リスト同期
- **`src/main/path-validator.ts`**: 動的 allow リスト `dynamicAllowed: Set<string>` を追加。`registerDynamicAllowedPath` / `unregisterDynamicAllowedPath` を export。`validatePath` は静的 prefix と動的リストの両方をチェック
- **`src/main/ipc-handlers.ts`**: `pinnedDirs:get/add/remove` IPC 追加。`pinnedDirs:add` は `validatePath` を**通さず** `pinnedDirectoryManager.add` 直渡し（OS ダイアログで明示的に選んだパスは信頼）
- **新規 `src/renderer/stores/pinnedDirsStore.ts`**: 楽観更新 + IPC 失敗時 rollback の Zustand。`init()` / `add(path)` / `remove(path)` / `paths`
- **`src/renderer/utils/labelCollision.ts`**: `CwdTab` に `pinned: boolean` / `lastActivePaneId: string \| null` 追加。`buildCwdTabs(panes, pinnedCwds[])` でペイン由来 + pinned-only タブを統合構築（順序: ペイン由来 createdAt 昇順 → pinned-only 追加順）
- **`src/renderer/components/Sidebar/Sidebar.tsx`** / **`SidebarTabs.tsx`**: 「+ ツリーを追加」ボタン + コンテキストメニューに「ピン留めする/外す」+ pinned タブの 📌 アイコン。pane-less タブ選択時は `setActiveTerminal` をスキップ
- **新規 `simple-git` (npm, v3.36.0)** + **`src/main/git-manager.ts`**: repo root キャッシュ + status / branch / stage / commit / push / pull / fetch / diff / branchSwitch・Create・Delete。エラーは全て `{ ok: false, error }` で統一返却（throw しない）
- **`src/main/ipc-handlers.ts`**: `git:*` の 13 ハンドラ追加（全て `validatePath` 通過後 `gitManager` へ委譲）
- **`src/preload/index.ts`**: `window.api.git.*` / `window.api.pinnedDirs.*` / `window.api.shell.openPath` を公開
- **新規 `src/renderer/stores/gitStore.ts`**: `repos: Map<cwd, RepoState>` で CWD ごとに status / branches / loading / error を管理。`refresh(cwd)` は `Promise.all([status, branchList])` を **try/catch で wrap** し、例外時に `error` 文言で確定して loading: true 凍結を防ぐ。`runOp(cwd, op, name)` は成功で auto refresh、失敗で toast
- **新規 `src/renderer/components/Sidebar/GitPanel.tsx`**: ブランチ表示 + Fetch/Pull/Push/+Branch + ブランチ list (切替/削除) + Staged / 変更 (各々 `resize: vertical` で縦リサイズ可、デフォルト 160px / 240px、min 80 / max 60vh) + コミットボックス + diff modal。loading 表示にも「再読込」ボタン (state 腐敗時の recovery)
- **`src/renderer/stores/sidebarStore.ts`**: `view: 'files' \| 'git'` と `setView` 追加
- **`src/renderer/components/Sidebar/SidebarTabs.tsx`**: 末尾に「⎇ Git」モード切替タブ追加（CWD タブ選択時は `view='files'` へ自動復帰）
- **`src/renderer/components/Sidebar/Sidebar.tsx`**: `view==='git'` のとき `<GitPanel cwd={selectedTabCwd} />`、それ以外は従来 `<DirectoryTree />`
- **新規テスト 47 件**: `xtermLine.test.ts` (6) / `materialIconResolver.test.ts` (15) / `markdownPath.test.ts` (+11 = `findPaths` 経路検証) / `labelCollision.test.ts` (+7 = pinned 統合) / `pinnedDirsStore.test.ts` (8) / `gitStore.test.ts` (6) / `pathHoverStore.test.ts` (4) + `markdownOpenService.test.ts` (+2 = ENOENT / EACCES 文言)
- **`src/renderer/test/setup.ts`**: `mockShellApi.openPath` / `mockPinnedDirsApi` / `mockGitApi` を追加
- **テスト合計**: 39 ファイル / 539 件グリーン（修正前 488 から +51 件）+ `npm run build` 通過（renderer 3.59 MB、+1.4 MB は SVG data URL inline 分）
- **同セッション内バグ修正 2 件**:
  - **「ピン留めに失敗しました」**: 原因は `validatePath` がホワイトリスト方式で HOME 外を弾いていたこと。`pinnedDirs:add` IPC を `validatePath` 通過なしに変更 + 動的 allow リスト機構を追加し、ピン留め後の `fs:readDir` 等 downstream 操作も透過
  - **Git「情報を読み込み中…」永続化**: 原因は `gitStore.refresh` の `Promise.all` を try/catch せず IPC rejection で loading: true 凍結。try/catch + `console.error` 診断ログ + GitPanel に「再読込」ボタンを追加して recovery 可能に
- **session-verifier 経由の追加修正**:
  - `src/renderer/utils/materialIconResolver.ts` 先頭に `/// <reference types="vite/client" />` を追加（`import.meta.glob` 型解決）
  - `src/renderer/stores/__tests__/gitStore.test.ts` で Promise constructor 内代入の TS 制御フロー narrowing 回避（明示 cast）
  - `src/renderer/components/Sidebar/GitPanel.tsx` の diff useEffect に `.catch` 追加（unhandled rejection 防止）
- **設計判断**:
  - **Material Icon Theme を選んだ理由**: VSCode 標準 (Seti) は VSCode 内蔵フォントで外部公開なし。VSCode の人気 Material Icon Theme は同作者が `material-icon-theme` npm (MIT) として正式公開しており、`generateManifest()` で完全な拡張子→アイコンのマッピングが取れる。週次更新でメンテも活発
  - **Vite glob の絶対パスと相対パスの罠**: `import.meta.glob('/node_modules/...')` は vitest ではプロジェクトルート基準で動くが、electron-vite renderer は root が `src/renderer/` のため `src/renderer/node_modules/` を探して 0 個マッチで build 通過。テストは通るが production で SVG が一切バンドルされない隠れバグになる。**ソースファイルからの相対 glob を使うのが両環境で確実**
  - **path-validator 動的 allow リストで「ホーム外ピン留め」を許す**: 静的 ALLOWED_PREFIXES だけだと `/opt/projects` 等を扱えず開発用途で詰む。OS ダイアログで明示選択したパスは信頼してよいので、選択時に `registerDynamicAllowedPath` で許可リスト追加 + 起動時に永続パスを再登録。defense-in-depth の趣旨は維持しつつ、ユーザー操作で広げられる構造にした
  - **Git タブを CWD タブ列に統合（モード切替式）**: 別サイドバー / モーダルではなく、既存 CWD タブの末尾に「⎇ Git」を置き、選択するとサイドバー下半分が GitPanel に切替わる。CWD と Git は同じリポジトリを別視点で見るものなので、選択 = 文脈共有が UX として自然。CWD タブ選択時は `view='files'` に自動復帰させて相互排他に
  - **simple-git は CLI 委譲、認証はユーザー環境に任せる**: `~/.gitconfig` / `ssh-agent` / `osxkeychain` 等の既存セットアップがそのまま効く。HTTPS 認証や 2FA を内蔵処理しない方針。代わりに `git push` 等の rejection はそのまま `error` 文字列としてユーザに返す
  - **gitStore.refresh の try/catch は防御 1 段目**: 観測された「読み込み中…永続化」は IPC のどこかで例外伝播していた可能性が高いが、根本原因の特定よりも「loading: true で固まらない不変条件」を強制する方が再発防止に強い。GitPanel 側にも「再読込」ボタンを置き、state 腐敗時のユーザ recovery 経路を確保
  - **Staged / 変更セクションは CSS resize: vertical**: 独自リサイズハンドル実装は不要。Chromium ネイティブの resize ハンドル（右下のドットドラッグ）が動作良好で、min-height/max-height で範囲を縛るだけ。各セクション独立スクロールにすることで多ファイル時にも見やすい
  - **path hover panel は markdown link provider を unified 化**: 別 provider を 2 つ重ねると xterm 上で範囲衝突の挙動が複雑化するため、`findPaths` で kind を返す統一 provider にし、activate でルーティング（md → 右サイドバー / その他 → shell.openPath）。hover/leave コールバックは kind を問わず一律発火
  - **画面構成変更時の「再起動忘れ」リスクの認知**: dev mode で main process 変更時は Electron 再起動が必要。本セッションで Git タブ「読み込み中」の誤認原因の一つの可能性。今後 main 側変更時は `npm run dev` 再起動を user に明示する運用に
  - **VSCode の Seti は外部公開されていない事実**: 当初「VSCode 標準アイコンを使えば」と考えたが、Seti は VSCode 内蔵フォントで配布対象外。Material Icon Theme で代替するのが現実解と判明（web-researcher による調査結果）

### 2026-05-04 - Markdown 表示を右サイドバーに一本化（ペイン内 viewMode 廃止）

#### 概要

ユーザー要望「現在 markdown を表示するとパネル選択が必要だが、右サイドバーを新設してそこに表示させたい。リサイズ可能で最大幅は中央付近まで、Markdown クリックで自動オープン、未選択時は『ファイルを選択してください』と表示」を実装。設計判断 3 点をユーザーに確認: (A) ペイン内 MD 機能（CLI/MD タブ UI / `viewMode` / OpenMarkdownModal）を**完全廃止して右サイドバー一本化**、(B) 複数タブを残して既存 mdTabs 機能を**グローバル化（ペイン非依存の単一ストア）**、(C) Header 右側にパネルアイコンを追加し**自動開閉のみ**（ショートカット追加なし）。サイドバー幅は絶対値 px で永続化し、表示時に `window.innerWidth × 0.5` を上限として実行時 clamp。`viewMode` 概念と `mdTabs` をペインスコープから外し、`markdownTabsStore`（グローバル MD タブ）+ `rightSidebarStore`（開閉 / 幅）を新設。`MarkdownEditor` は `paneId` 依存を撤去して `tabId` のみで動作するよう書き換え。`TerminalPane` から `viewMode` / `mdTabs` / md→cli 復帰時の re-fit ロジックを撤去（xterm 常時表示）。`TerminalSubHeader` から CLI/MD タブ UI と dirty 警告フローを撤去（タイトル rename / clear / insert / close は維持）。Sidebar からの「編集する」/シングルクリックは `openMarkdownInRightSidebar(filePath)` に簡素化し、自動オープン。Header 右側に `PanelRightIcon` のトグルボタンを追加。session-state スキーマから `mdTabFilePaths` を削除（後方互換: 旧 JSON が残っていても validator で黙って無視）。発見した起動時レースコンディション（永続化値読込前の `setOpen(false)` 上書き）を `openInitialized` フラグで解消。テスト 480 件（既存 467 + 新規 22 [markdownTabsStore 9 + rightSidebarStore 13]）+ `npm run build` グリーン。

#### 変更点

- **新規 `src/main/right-sidebar-state.ts`**: `right-sidebar-state.json` で width / isOpen を永続化。`width` は MIN=320 / 物理上限 4000 で clamp（実際の上限は renderer 側でウィンドウ幅の 50% に再 clamp）、save は 250ms debounce
- **新規 `src/renderer/stores/rightSidebarStore.ts`**: `isOpen` / `width` / `setOpen` / `toggleOpen` / `setWidth`（clamp 経由）。`effectiveMaxWidth()` で `window.innerWidth × RIGHT_SIDEBAR_MAX_RATIO(=0.5)` を返し、`clampRightSidebarWidth()` でドラッグ中・mount 時に再 clamp
- **新規 `src/renderer/stores/markdownTabsStore.ts`**: ペイン非依存の単一 MD タブ管理。`tabs: MdTab[]` / `activeTabId` / `openMarkdown(filePath, content)` / `setActive` / `closeTab` / `setDirty` / `markSaved` / `canOpenMore` / `clearAll`、上限 `MD_TABS_MAX = 8` を踏襲。`useMdTab(tabId)` セレクタ提供
- **新規 `src/renderer/components/RightSidebar/RightSidebar.tsx`**: aside ルート + タブ列（既存 mdTabs UI のスタイル踏襲）+ MarkdownEditor + 左端 ResizeHandle + 空状態「ファイルを選択してください」。dirty タブ close 時は `UnsavedChangesModal`（reason="open-other"）で警告。永続化値読込完了まで `setOpen` IPC 送信を保留する `openInitialized` フラグで起動時レース解消。`window.resize` イベントで現在幅を再 clamp
- **新規 `src/renderer/components/RightSidebar/RightSidebarResizeHandle.tsx`**: 左端ドラッグハンドル。`rect.right - e.clientX + 2` で「右端からの距離 = 新しい幅」を計算（左サイドバーと逆方向）
- **新規 `src/renderer/components/RightSidebar/RightSidebarFilePicker.tsx`**: 「+」ボタンから開く Portal ドロップダウン。検索フィールド + 全 watch 中 CWD の .md 最大 50 件 + 末尾「ファイルを選択...」（`dialog.selectFiles`）。旧 `MdTabPickerDropdown` のペイン依存版を置き換え
- **`src/main/ipc-handlers.ts`**: `rightSidebar:getWidth` / `setWidth` / `getOpen` / `setOpen` の 4 ハンドラを追加
- **`src/preload/index.ts`**: `window.api.rightSidebar.{getWidth,setWidth,getOpen,setOpen}` を公開
- **`src/renderer/components/MarkdownEditor.tsx`**: `paneId` props 削除、`tabId` のみで動作。`useMdTab(tabId)` で `markdownTabsStore` から tab を購読。`onMouseDownCapture` の `setActiveTerminal(paneId)` を撤去（右サイドバーは terminal とは独立）
- **`src/renderer/components/TerminalPane.tsx`**:
  - `MarkdownEditor` import / `viewMode` / `mdTabs` / `activeMdTabId` / `isOverlayed` / `prevOverlayedRef` / md→cli 復帰時の `useLayoutEffect` re-fit ロジックを全削除
  - xterm container を常時 `display: block` に（`isOverlayed ? "none" : "block"` を撤廃）
  - `requestEditMarkdownFromTerminal(abs, id)` → `requestEditMarkdownFromTerminal(abs)` に変更（paneId 不要）
- **`src/renderer/components/TerminalSubHeader.tsx`**: CLI/MD タブ UI（`showTabs` / `mdTabs.map` / `+` ボタン / `MdTabPickerDropdown` 起動 / `handleClickCliTab` / `handleClickMdTab` / `handleCloseMdTab`）を全削除。`handleClosePane` の dirty 警告ロジックも撤去（MD はペイン非依存になったため）。タイトル rename / process display / scrollback clear / file insert / close pane は維持
- **`src/renderer/services/markdownOpenService.ts`**: 大幅簡素化（314 行 → 56 行）。ペイン選択ダイアログ / `NEW_PANE_CHOICE` / `openMarkdownInPane` / `openMarkdownInNewPane` / CWD 内外判定を全廃。`openMarkdownInRightSidebar(filePath)` 単一エントリポイントに統一（読込 → openMarkdown → `setOpen(true)`）。旧 `requestEditMarkdownFromSidebar` / `requestEditMarkdownFromTerminal` は互換シムとして残し内部で `openMarkdownInRightSidebar` を呼ぶ
- **`src/renderer/stores/terminalMetaStore.ts`**: `viewMode` / `mdTabs` / `activeMdTabId` フィールド削除、関連 actions（`openMarkdown` / `setViewMode` / `setActiveMdTab` / `closeMdTab` / `setMdDirty` / `markMdSaved` / `clearMarkdown` / `canOpenMoreMd`）削除。`hydrateMetas` の `mdTabFilePaths` 引数を撤去
- **`src/renderer/stores/markdownDialogStore.ts`**: `OpenConfirmRequest` 型を削除し、`UnsavedRequest` のみに簡素化。`showOpenConfirm` action 削除、`paneId` フィールド削除（タブ ID で十分）
- **`src/renderer/components/UnsavedChangesModal.tsx`**: `UnsavedReason` を `"switch-to-cli" \| "open-other" \| "close-pane"` から `"open-other"` のみに縮約。文言を「このタブを閉じると、編集中の内容は失われます」に更新
- **`src/renderer/services/sessionRestore.ts`**: serialize / restore から `mdTabFilePaths` を削除（葉ペインの `cwd` のみ保存対象に戻す）。旧 JSON に `mdTabFilePaths` が残っていても無視
- **`src/renderer/services/sessionPersist.ts`**: `hasMdTabPathsChanged` を削除、`hasCwdChanged` のみで保存トリガを判定
- **`src/shared/session-state-validator.ts`**: `SerializedMeta.mdTabFilePaths` フィールドと `SESSION_STATE_MAX_MD_TABS` 定数を削除。validator は旧形式に `mdTabFilePaths` が含まれていても黙って無視（後方互換）
- **`src/renderer/components/Header.tsx`**: 右サイドバートグルボタンを設定ボタンの左隣に追加（`PanelRightIcon` / `useRightSidebarStore.toggleOpen`）。aria-pressed / hover 状態 / 開閉時のボーダー色変化は左サイドバートグルと統一
- **`src/renderer/components/Sidebar/icons.tsx`**: `PanelRightIcon` を新規追加（`PanelLeftIcon` の鏡映: `<line x1="15" y1="3" x2="15" y2="21" />`）
- **`src/renderer/App.tsx`**: 大幅整理（682 行 → 568 行）。
  - `<RightSidebar />` を main area の最右に追加（Sidebar / SplitContainer の隣）
  - `OpenMarkdownModal` import / render を撤去、`dialogRequest?.kind === "unsaved"` のみ render
  - `handleRequestEditMarkdown` を `openMarkdownInRightSidebar(filePath)` 1 行に簡素化
  - `close-pane` ショートカットの dirty 警告フローを撤去（MD はペイン非依存）
  - `resolveActiveViewMode()` を撤去し、`isMarkdownEditorFocused()` で「現在 MD エディタに focus があるか」を判定。`adjustGlobalFontSize` / `resetGlobalFontSize` はこれをもとに editor / terminal を切替
  - `isInsideMarkdownEditor` の検出セレクタを `[data-md-editor-pane]` から `[data-md-editor-tab]` に変更（paneId 依存撤去に伴う rename）
- **削除**: `src/renderer/components/OpenMarkdownModal.tsx`（241 行）、`src/renderer/components/MdTabPickerDropdown.tsx`（314 行）、`src/renderer/components/__tests__/OpenMarkdownModal.test.tsx`（149 行）
- **新規テスト 22 件**:
  - `stores/__tests__/markdownTabsStore.test.ts` (9): openMarkdown 新規追加 / 既存タブアクティブ化 / 上限 8 到達 / closeTab 左隣フォールバック / 最後のタブで activeTabId=null / setDirty タブ独立 / markSaved / canOpenMore
  - `stores/__tests__/rightSidebarStore.test.ts` (13): clamp の min/max/round/non-finite/overflow/underflow / `effectiveMaxWidth` の 50% 計算 / setOpen / toggleOpen / 値同一時の no-op / setWidth + clamp
- **既存テスト改訂**:
  - `terminalMetaStore.test.ts`: `mdTabs` 系テスト群（restore / openMarkdown / closeMdTab / setMdDirty / markMdSaved / canOpenMoreMd）を削除、初期化系の核テストのみ維持
  - `markdownDialogStore.test.ts`: `showOpenConfirm` テスト 3 件削除、`UnsavedRequest` ベースの 2 件のみ維持
  - `markdownOpenService.test.ts`: 旧 API ベースの巨大テスト群を撤去、`openMarkdownInRightSidebar` の 5 ケース（happy / 自動オープン / 非 MD スキップ / 上限到達 / readFile 失敗）に書き換え
  - `mdFileListing.test.ts`: `makeMeta()` から `viewMode / mdTabs / activeMdTabId` を削除
  - `TerminalPane.test.tsx`: md→cli 遷移テスト 2 件を削除、`useTerminalMeta` mock を簡素化
- **テスト合計**: 34 ファイル / 480 件グリーン（修正前 467 から +13 件）+ `npm run build` 通過
- **設計判断**:
  - **viewMode の概念を全廃 → 右サイドバー独立表示**: 旧仕様「ペイン内で CLI/MD overlay 切替」は xterm の display:none / 復帰時の re-fit / scrollback cols 整合 / 復帰直後の入力安全性 / md→cli の useLayoutEffect 二段保険など複雑なロジックを生んでいた。MD を完全に別領域（右サイドバー）に分離することで、xterm は常に表示され続け、MD タブ切替も terminal の resize lifecycle を一切触らない。コード量・状態空間・バグ可能性が劇的に縮小
  - **MD タブをグローバル化（ペイン非依存）**: 旧仕様の「ペインごとに mdTabs を持つ」は、ペイン close 時の dirty 警告 / セッション復元時のペインバインド / + ボタンの paneId 引数など、本質的でない複雑性を生んでいた。MD は「アプリ全体で 1 つのワークスペース」として捉える方が UX 自然（複数ペインが同じ MD を参照するケースで一貫）。グローバル化で `paneId` を引数から完全に削除でき、API も簡潔化
  - **最大幅は実行時にウィンドウ幅 × 50% で clamp**: ユーザー要望「中央付近まで」を画面幅の半分として解釈。永続化は絶対値 px のままにして、ウィンドウサイズ変化時に再 clamp + 永続化更新。ウィンドウを縮めた後に拡げると、縮めた時点の幅は失われる（永続化値も clamp 済み）が、UX 上の混乱はない（ユーザーは現在見える幅で記憶している）
  - **左サイドバーと同じ独自 ResizeHandle パターン**: react-resizable-panels の Group/Panel/Separator は SplitContainer 内で既に使っており、サイドバーの絶対配置リサイズには合わない。既存 `Sidebar/ResizeHandle.tsx` と同じく `position: absolute` + `mousedown/mousemove/mouseup` で実装。座標計算だけ反転（`rect.right - clientX` で右端からの距離）
  - **「ファイルを選択してください」の空状態を内蔵**: タブが 0 件のときも RightSidebar 自体は開いた状態を保ち、中央に文言を表示する。ユーザーが Header トグルで先に開いてからファイルを選ぶフローを自然に許容する。Sidebar の「ターミナルが起動するとここに CWD が表示されます」と同じ思想
  - **dirty 警告は「タブ close」のみに残す**: 旧仕様の `switch-to-cli` / `close-pane` reason は概念ごと不要に（CLI への切替は「右サイドバーを閉じる」だけで MD 状態は破壊されないため、ペイン close は MD と無関係になったため）。`open-other` だけが残る
  - **起動時のレースコンディションを `openInitialized` フラグで解消**: `useEffect [isOpen]` が初期 isOpen=false で発火 → main 側に setOpen(false) を送信 → main の永続化値（前回 open=true）を上書き、というレースが発見された。永続化値の取得 promise が解決するまで IPC 送信を保留する state フラグで解消。useRef ではなく useState を使う理由は、フラグ変化で再レンダーをトリガしないと「getOpen 解決前にユーザーがトグルした場合」が永続化されないため
  - **`mdTabFilePaths` をセッションスキーマから削除（後方互換維持）**: グローバル化に伴い「ペイン単位の MD タブ復元」は無意味に。CLAUDE.md §3.7 の「保存対象: レイアウト二分木と各葉ペインの CWD のみ」本来の仕様にも合致。旧 JSON にフィールドが残っていても validator で黙って無視することで、既存ユーザーのセッション破棄を防ぐ
  - **MdTabPickerDropdown を新規 RightSidebarFilePicker に置き換えた理由**: 既存ファイルを修正する案もあったが、(a) `paneId` 引数全廃、(b) anchor の親が変わる、(c) `openMarkdownDirect(paneId, fp)` から `openMarkdownInRightSidebar(fp)` に呼び出し変更、と差分が大きく、新規ファイルにした方が読みやすい
  - **Header トグルの位置（右側 / 設定ボタン左隣）**: 左サイドバートグルが Header 左側にあるのと対称な配置。Settings ボタンの隣に置くことで「画面構成の制御」アイコン群を視覚的にまとめる
  - **ショートカットを追加しなかった理由（ユーザー回答 3）**: 自動開閉（Markdown クリック → 自動 open）が主動線になるので、明示開閉のショートカットは出番が少ない。Cmd+B 系は左サイドバーで埋まっており、衝突を避けたい。将来要望があれば `right-sidebar-toggle` を registry に追加可能な設計を保つ

### 2026-05-02 - ズーム / split / scrollback 連鎖バグ修正（pty.resize debounce + Chromium 抑制）

#### 概要

ユーザー報告の 3 連続バグを根本原因まで掘り下げて修正。(1)「Cmd+\_ がまだ縮小として効く」: globalShortcut で intercept しないキーは Chromium が `prePerformKeyEquivalent:` で webFrame zoom として消費するため、`Cmd+= / Cmd+Plus / Cmd+Shift+= / Cmd+Shift+-` を no-op の SUPPRESS_ACCELERATORS として登録して抑制。フォントズームのアクティブショートカットは `Cmd+;`（拡大）と `Cmd+-`（縮小）と `Cmd+0`（リセット）の 3 つのみに整理。(2)「分割直後にスクロールバックが 2 文字幅で表示される」: `react-resizable-panels` を v2.1.7 → v4.5.9 にアップグレードした際の API 変更（数値 = ピクセル化）に追従漏れがあり、`defaultSize={50}` が 50% ではなく 50 ピクセルとして解釈されていた。`defaultSize="50%"` / `minSize="10%"` の percent string に修正。さらに `terminalManager.fit()` に `proposeDimensions()` の事前検証を追加し、`MIN_REASONABLE_COLS=5` 未満の異常値では `fitAddon.fit()` を呼ばない（呼ぶと scrollback が破壊的に reflow されて元に戻らない）。(3)「長文中に同じ文章が一つのパネル内に複数縦に並ぶ」: ペイン境界 drag や CSS transition で Panel.onResize / ResizeObserver がフレーム単位で発火し、毎フレーム `pty.resize` IPC → SIGWINCH → TUI（Claude CLI 等）が連続再描画 → 古い描画が scrollback に積層する SIGWINCH スパムが原因。`terminalManager.ts` に PTY 専用の trailing-debounce（80ms）を新設し、`fit()` 内部で `schedulePtyResize` を呼ぶ集中管理に切替。caller 側の `window.api.pty.resize` 二重呼び出し（TerminalPane.handleFit / applyOptions / SplitContainer.handlePanelResize）を撤去。`destroy(id)` でも保留中 timer をクリアして破棄済みペインへの IPC 漏洩を防止。テスト合計 33 ファイル / 484 件グリーン（修正前 479 から +5 件: proposeDimensions ガード 2 件 / pty.resize debounce 集約 + cancel + destroy クリーンアップ 3 件）。

#### 変更点

- **src/main/zoom-shortcuts.ts**: BINDINGS を `{ font-zoom:in: ["CommandOrControl+;"], font-zoom:out: ["CommandOrControl+-"], font-zoom:reset: ["CommandOrControl+0"] }` に統一。`SUPPRESS_ACCELERATORS = ["CommandOrControl+=", "CommandOrControl+Plus", "CommandOrControl+Shift+=", "CommandOrControl+Shift+-"]` を新設し、`registerAll()` 内で no-op コールバックの globalShortcut として登録 → OS レベルで先取り消費して Chromium のデフォルトズームに到達させない。`unregisterAll()` は SUPPRESS 分も REGISTERED に積んであるため自動的にクリーンアップされる
- **src/renderer/shortcuts/registry.ts**: `font-zoom-in` の defaultKey を `"Cmd+Plus"` → `"Cmd+;"` に変更。`Cmd+Plus` 用に書かれていた Shift 省略コメントを削除
- **src/renderer/App.tsx**: 早期 keydown ハンドラの `isZoomIn` マッチ条件を `e.key === "+" || (e.shiftKey && e.code === "Equal/Semicolon")` から `!e.shiftKey && (e.key === ";" || e.code === "Semicolon")` に書き換え。`Cmd+;` 単発の検出に純化
- **src/renderer/components/SplitContainer.tsx**: `<Panel minSize={10} defaultSize={100 / children.length}>` を `<Panel minSize="10%" defaultSize={`${100 / children.length}%`}>` に修正（v4 で number = px、string = % という新仕様に追従）。`handlePanelResize` から `window.api.pty.resize(panelId, ...)` を撤去（`terminalManager.fit()` 内部の debounce で集約）
- **src/renderer/services/terminalManager.ts**:
  - 定数 `MIN_REASONABLE_COLS = 5` を新設。`fit()` の `tryFit()` 内で `fitAddon.proposeDimensions()` を先に呼んで cols/rows を検証し、`cols < MIN_REASONABLE_COLS || rows <= 0` のときは `fitAddon.fit()` を呼ばずに null 返却（scrollback の破壊的 reflow を防止）
  - `PTY_RESIZE_DEBOUNCE_MS = 80` と `pendingPtyResizes: Map<id, { cols, rows, timer }>` を新設。`schedulePtyResize(id, cols, rows)` で既存予約を `clearTimeout` してから `setTimeout` で再スケジュール → 連続発火しても最終サイズだけが PTY に届く
  - `fit()` 内のサイズ変化判定後（または rAF retry 成功後）で `schedulePtyResize` を呼ぶよう変更。これにより caller が `window.api.pty.resize` を直接呼ばなくても自動的に PTY に伝わる
  - `destroy(id)` で `pendingPtyResizes.get(id)` を `clearTimeout` + `delete`（破棄済みペインへの IPC 漏洩防止）
  - テスト用 export `cancelPendingPtyResizes()` を追加
- **src/renderer/components/TerminalPane.tsx**:
  - `handleFit` から `window.api.pty.resize(id, result.cols, result.rows)` を撤去。`terminalManager.fit(id)` のみに簡略化（重複呼び出しは debounce を素通りして SIGWINCH スパムを再導入するため NG）
  - `applyOptions` の戻り値を握りつぶし、その後の `window.api.pty.resize` も撤去
- **src/renderer/components/settings/TerminalSettings.tsx**: 説明テキストを「`Cmd+= / Cmd+-` でアクティブペインのみ拡縮」→「`Cmd+; / Cmd+-` でアクティブペインのみ拡縮」に変更
- **新規テスト 5 件 (`renderer/services/__tests__/terminalManager.test.ts`)**:
  - `skips fit when proposeDimensions returns cols below MIN_REASONABLE_COLS`: 提案 cols=2 のときは `fitAddon.fit()` が呼ばれず null 返却
  - `skips fit when proposeDimensions returns undefined`: undefined 提案でも安全に null 返却
  - `coalesces rapid fit() calls into a single pty.resize (last value wins)`: 異なる 3 サイズで連続 `fit()` → debounce 中は IPC 0 件 / 80ms 経過後に最終サイズ 1 件のみ IPC される
  - `cancelPendingPtyResizes drops pending IPC`: pending を明示的にキャンセルすると 200ms 経過しても IPC されない
  - `destroy() cancels pending pty.resize for that id`: debounce 経過前に destroy → タイマーが解除され破棄済み id への IPC が飛ばない
- **既存テスト更新**:
  - `MockFitAddon` に `proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }))` を追加（既定で妥当な提案を返す）
  - `terminalManager` の rAF retry テストを fake timers に切替えて 100ms 進めて `pty.resize` の呼び出しを検証
  - `SplitContainer.test.tsx` / `TerminalPane.test.tsx`: 「fit + 直 IPC」検証から「invalidate + fit のみ呼ばれる」検証に書き換え（pty.resize は terminalManager 内部の debounce 経由になったため、コンポーネント層では検証しない）
  - `registry.test.ts`: `font-zoom-in default is Cmd+Plus` → `Cmd+;` に更新
- **テスト合計**: 33 ファイル / 484 件グリーン（修正前 479 から +5 件）+ `npm run build` 通過
- **設計判断**:
  - **Chromium デフォルトズーム抑制を SUPPRESS_ACCELERATORS でやる根拠**: Electron の `webContents.setVisualZoomLevelLimits` は pinch zoom 専用で、キーボードショートカットには効かない。`before-input-event` で `preventDefault` する手もあるが、Chromium は `prePerformKeyEquivalent:` でこれより前にズームを発火する。OS レベルの globalShortcut は最も早い経路に乗り、no-op コールバックを置くだけで Chromium への到達を遮断できる
  - **`Cmd+;` 単発を拡大に選んだ理由**: ユーザー要望「`Cmd+Shift+; / Cmd+Shift+=` の 2 候補を `Cmd+;` 一つだけにして」に従う。Shift なしの `;` キー単体は `Plus` キーと違って US/JIS の差を受けず一意で、`Cmd+,`（設定）の隣で運指も近い。Chromium のデフォルトとも衝突しない
  - **`react-resizable-panels` v4 で number→px に変わった経緯**: v2/v3 は `defaultSize={50}` を 50% として解釈していたが、v4 で「数値 = px」「文字列 = %」と仕様変更された（CSS の他単位 `rem`/`vh` 対応のため）。マイグレーションガイドを見落としていたため `defaultSize={50}` が 50px として解釈され、splitter 直後にペイン幅が 50px → xterm fit-addon が `MINIMUM_COLS=2` までクランプ → scrollback が破壊的に再 wrap される連鎖が起きていた
  - **`MIN_REASONABLE_COLS=5` 未満で fitAddon.fit を見送る理由**: xterm の MINIMUM_COLS=2 まで落ちると `terminal.resize(2, rows)` がそのまま走って scrollback が 2 文字幅で再 wrap される。reflow はロスを伴うため、後で広い cols に戻しても元の見た目には戻らない（80 文字行が 40 行 × 2 文字に分割されたまま固着）。`proposeDimensions()` で先に検証して `fitAddon.fit()` 自体を呼ばないことが正しい防御
  - **PTY resize の trailing-debounce を 80ms に設定**: drag-resize の体感的な「区切り」（指がやや止まる瞬間）が 50〜100ms 程度。80ms は: (a) drag 中の連続発火を確実に集約、(b) drag 終了後の最終 SIGWINCH を素早く届ける、のバランス。長すぎると release 後にカーソル位置がしばらく古い cols のまま残る違和感が出る
  - **xterm 側 reflow は即時 / PTY 側 SIGWINCH は debounce の二段構え**: xterm の `terminal.resize()`（fitAddon.fit 内部）は即時実行して見た目をスムーズに追従させ、PTY への通知だけ集約する。これにより drag 中の視覚的レスポンスは保ちつつ、TUI（Claude CLI / Vim 等）の連続再描画を防げる。debounce 中の 80ms 間は xterm.cols=40 / PTY.cols=80 の不整合があるが、PTY からの出力を xterm が wrap するだけなので実害なし
  - **caller 側の `window.api.pty.resize` を撤去した理由**: `fit()` 内部で `schedulePtyResize` を呼ぶ仕様にしたあと、caller が直接 `window.api.pty.resize` を呼ぶと debounce を素通りして SIGWINCH スパムが復活する。「fit を呼んだら pty も resize される」という単一責務に統一し、TerminalPane.handleFit / applyOptions / SplitContainer.handlePanelResize の 3 箇所から重複呼び出しを撤去
  - **`destroy(id)` で pendingPtyResizes をクリアする根拠**: ペイン close 直後にまだ debounce が経過していない pty.resize が残っていると、`window.api.pty.resize(deadId, ...)` が main プロセスへ飛ぶ。Main 側は知らない id を握りつぶすだけだが、IPC リソースの無駄遣い + ログノイズ + 将来 main 側で warn を出すようにすると誤報になる。同 destroy 内で `lastSizes.delete(id)` / `pathBuffers.delete(id)` をしているのと同じ性質のクリーンアップ
  - **`pty.create` 直後の初期 resize は debounce 経由にしない**: TerminalPane の pty.create flow にある `window.api.pty.resize(id, cols, rows)` は startup の one-shot で、direct 呼び出しのまま残した。これは「PTY が初期出力を流す前に正しい cols を知っておく必要がある」一種の同期点で、80ms 遅らせると zsh 起動メッセージが小さい cols（24 cols のシェルデフォルト）で wrap されるため。fit 経由ではないので新 debounce path とは独立に動く
  - **テスト書き換えの方針**: SplitContainer / TerminalPane の責務が「fit を呼ぶ」までになったので、コンポーネント層では `pty.resize` を検証しない。`pty.resize` の挙動は `terminalManager.test.ts` でドメインごとにカバー（debounce coalesce / cancel / destroy）。これにより責務境界が tests に反映され、将来 caller を増やしても terminalManager 側のテストでデバウンスが担保される
  - **既知の Issue #002（scrollback cols 不整合）との関係**: 2026-04-27 のフィックスでは「fit が呼ばれない経路」を 5 つ塞いだが、今回見つかった「fit が**呼ばれすぎる**経路」は対角線の問題。`MIN_REASONABLE_COLS` ガード + pty.resize debounce で双方向の防御が揃う

### 2026-05-02 - Chat UI 完全廃止（T3-5 撤回）

#### 概要

T3-5 として実装した Claude Code Chat UI を機能ごと撤回。Claude サブスクリプション認証を内蔵したまま第三者にビルドが渡るリスク（規約上グレー〜アウト）を避けるため、コードを残さず完全削除した。`viewMode: "cli" | "md" | "chat"` を `"cli" | "md"` に縮約、`AppSettings.chat` を schema から除去、`chat:*` IPC 10 チャネル全廃。削除直前のコードは `pre-chat-removal` タグで保全しているため、復活時は git history から個別 cherry-pick 可能。テスト 479 件・electron-vite build 全グリーン。（計画書: archive/2026-04-30-remove-chat-ui.md）

#### 変更点

- **削除（17 ファイル）**: `src/renderer/components/ChatPane/` 配下 8 ファイル（ChatPaneView / MessageList / MessageBubble / ChatInput / ChatStatusBar / ChatWelcome / ChatTrustPanel / SlashMenu）、`src/renderer/stores/chatSessionStore.ts` + テスト、`src/renderer/services/chatBridge.ts`、`src/renderer/types/chat.ts`、`src/main/chat-session-manager.ts`、`src/main/claude-process-detector.ts` + テスト、`src/main/slash-items.ts` + テスト、`src/main/trusted-dirs.ts` + テスト、`src/shared/chat-events.ts`
- **部分修正（17 ファイル）**: `src/main/ipc-handlers.ts`（chat:_ ハンドラ 8 種 + import 3 行 + before-quit の killAll 削除）、`src/main/window-manager.ts`（chatSessionManager / claudeProcessDetector の register/unregister 削除）、`src/main/pty-manager.ts`（claudeProcessDetector.feedChunk / reset 3 箇所削除）、`src/preload/index.ts`（`window.api.chat` ブリッジ全削除 + ChatEventEnvelope import 削除）、`src/renderer/main.tsx`（initChatBridge 削除）、`src/renderer/App.tsx`（CHAT*FONT_SIZE*_ import 削除、resolveActiveViewMode の戻り型を `"cli" \| "md" \| null` に縮約、adjustGlobalFontSize / resetGlobalFontSize から chat 分岐削除）、`src/renderer/components/TerminalPane.tsx`（ChatPaneView import / showChat / mountChat / hasChatSession 削除）、`src/renderer/components/TerminalSubHeader.tsx`（CLI/Chat segmented タブ + 「Chat 起動」吹き出しアイコン削除、handleClickChatTab / handleCloseChatTab / handleStartChat 削除、segmentStyle 関数削除）、`src/renderer/stores/terminalMetaStore.ts`（ViewMode を `"cli" \| "md"` に縮約）、`src/renderer/stores/terminalStore.ts`（chatSessionStore import + closeTerminal 内の chat.dispose / remove 削除）、`src/renderer/stores/settingsStore.ts`（patch.chat マージ + useChatSettings セレクタ削除）、`src/renderer/stores/__tests__/terminalStore.test.ts`（window.api.chat モック削除）、`src/shared/settings.ts`（ChatSettings 型 / validateChatSettings / CHAT_FONT_SIZE_MIN/MAX 定数 / DEFAULT_SETTINGS.chat / cloneDefaults / mergeSettings / validateAppSettings の chat フィールド全削除）、`src/shared/__tests__/settings.test.ts`（base AppSettings の chat フィールド + chat clamp 2 ケース削除）、`.claude/CLAUDE.md`（§T2-10 から chat 記述全削除）、`.claude/docs/known-issues/INDEX.md`（Issue 003 を Withdrawn セクションへ移動）
- **アーカイブ移動**: `.claude/docs/known-issues/003-claude-cli-stream-json.md` → `.claude/docs/known-issues/archive/003-claude-cli-stream-json.md`（Status を Withdrawn に更新）
- **既存 archive 更新**: `.claude/archive/2026-04-29-claude-code-chat-ui.md` の Status を COMPLETED → WITHDRAWN、Withdrawn 日付・理由を追記
- **IPC チャネル削除**: `chat:start` / `chat:send` / `chat:stop` / `chat:dispose` / `chat:getSessionId` / `chat:checkTrust` / `chat:trust` / `chat:listSlashItems` / `chat:event` / `chat:claudeDetected` の計 10 種
- **Branch / Tag**: `feat/remove-chat-ui` ブランチで作業中（main からは未マージ）。削除直前のスナップショットを `pre-chat-removal` タグで保全（main の HEAD = 41322e2 の `chore(chat): WIP polish snapshot before removal` を指す）。復活時は `git checkout pre-chat-removal -- <path>` で個別取得可能
- **残存リスク（記録）**: 既存ユーザーの `userData/trusted-dirs.json` は削除されないが、Reader が消えたため不活性ファイル化するだけで実害なし。次バージョンで起動時 cleanup を入れるかは別タスクで判断
- **Coding 判断**: trusted-dirs / slash-items / claude-process-detector は他用途への流用可能性があったが、構造的に chat 専用 API 形状（CWD 信頼確認 / `/` コマンド補完 / OSC 0 ✳ Claude Code バナー検出）であり、汎用的な再利用には設計しなおしが必要なので機能ごと削除した

### 2026-04-30 - アプリ全体ズーム機能追加 + per-pane フォントズームを MD/Chat に拡張

#### 概要

ユーザー要望「Cmd+= / Cmd+- が現状ターミナルに絞られているが、本来はアプリ画面全体の拡大縮小を意図したかった。今のターミナル個別ズームは残したまま、別途アプリ全体ズーム機能を追加してほしい。さらにターミナルの拡大縮小は markdown / chat にも対応させてほしい」を実装。アプリ全体ズームは `general.appZoomFactor`（既定 1.0、範囲 0.5〜2.0、step 0.1）を新設し、preload で `webFrame.setZoomFactor` を直接ブリッジ（contextIsolation 下でも preload は webFrame を呼べるため IPC 不要）。Renderer の App.tsx で `useSettingsStore` を購読し設定変更ごとに即時適用（idempotent setter なのでクリーンアップ不要）。Settings の「一般」タブに − / 倍率表示 / + / リセット + 範囲スライダーを追加。per-pane ズーム（Cmd+= / Cmd+- / Cmd+0）はアクティブペインの `viewMode` に応じてターゲットを切替: `cli` → `terminal.fontSize`（既存挙動維持）/ `md` → `editor.fontSize`（MarkdownEditor は元から `editorSettings.fontSize` を参照していたため自動連動）/ `chat` → 新規 `chat.fontSize`（既定 13.5、範囲 10〜28、ChatInput と MessageBubble の本文に反映）。`adjustGlobalFontSize` / `resetGlobalFontSize` を viewMode 分岐に書き直し、各々のクランプ範囲・既定値で動かす。`shared/settings.ts` に `ChatSettings` 型 / `validateChatSettings` / `mergeSettings` の chat 対応 / `APP_ZOOM_MIN/MAX/STEP` / `CHAT_FONT_SIZE_MIN/MAX` 定数を追加し、`general.appZoomFactor` も `clampNumber` で範囲検証。ChatInput の textarea 自動高さ計算に `chatSettings.fontSize` を依存追加してフォントサイズ変更時に即追従。設定 UI のリセット / 増減ボタンは APP_ZOOM_MIN/MAX 端点で disabled。テスト合計 37 ファイル / 514 件グリーン（chat / appZoomFactor の clamp / fallback / 破損ブロック復元の 4 ケース追加）。CLAUDE.md §8 T2-10 を新仕様（viewMode 分岐 + アプリ全体ズーム）に更新。

#### 変更点

- **shared/settings.ts**: `ChatSettings { fontSize: number }` を新規追加、`AppSettings` と `PartialAppSettings` に `chat` を組み込み。`general.appZoomFactor: number` を `GeneralSettings` に追加し、`validateGeneralSettings` で `clampNumber(value, APP_ZOOM_MIN, APP_ZOOM_MAX, default)` の検証を実装。`validateChatSettings` を新設し `clampNumber(value, CHAT_FONT_SIZE_MIN, CHAT_FONT_SIZE_MAX, default)` で fontSize 検証。定数 `APP_ZOOM_MIN=0.5` / `APP_ZOOM_MAX=2.0` / `APP_ZOOM_STEP=0.1` / `CHAT_FONT_SIZE_MIN=10` / `CHAT_FONT_SIZE_MAX=28` を export。`DEFAULT_SETTINGS.chat.fontSize=13.5` / `DEFAULT_SETTINGS.general.appZoomFactor=1.0`。`mergeSettings` / `cloneDefaults` / `validateAppSettings` の各所に `chat` の field-level マージを追加
- **renderer/stores/settingsStore.ts**: `applyOptimistic` に `patch.chat` の浅マージを追加。新規セレクタ `useChatSettings` を export
- **preload/index.ts**: `electron` から `webFrame` を import し、`window.api.window.setZoomFactor(value: number)` を新規公開。finite check + try/catch でガード（範囲外でも黙って無視）。webFrame は preload context で直接呼べるため Main 側の IPC ハンドラ不要
- **renderer/App.tsx**:
  - `resolveActiveViewMode()` ヘルパを新設（`useTerminalStore.getState().activeTerminalId` → `useTerminalMetaStore.getState().metas.get(id)?.viewMode` を返す、null フォールバック）
  - `adjustGlobalFontSize(delta)` を viewMode 分岐に書き直し: `md` → `editor.fontSize` をクランプ更新 / `chat` → `chat.fontSize` をクランプ更新 / `cli` or null → `terminal.fontSize`（既存挙動）。各々 no-op early return + クランプ範囲は対応定数を使用
  - `resetGlobalFontSize()` も同様の分岐: `md` → `DEFAULT_SETTINGS.editor.fontSize` / `chat` → `DEFAULT_SETTINGS.chat.fontSize` / `cli` or null → `terminal.fontSize=14` + `clearAllFontSizeOverrides()`
  - `useTerminalStore` を import に追加（既存の selector hook と並行して getState 用）
  - 新規 `useEffect`: `useSettingsStore((s) => s.settings.general.appZoomFactor)` を購読し変化時に `window.api.window.setZoomFactor(appZoomFactor)` を呼ぶ。起動直後 1.0 で 1 度走り、`load()` 完了後の永続化値で再走する
- **renderer/components/settings/GeneralSettings.tsx**: 「アプリ全体の表示倍率」セクションを追加。`setAppZoom(next)` で小数 2 桁丸め + クランプ + `update({ general: { appZoomFactor } })` を発火。− / 倍率%表示 / + / リセットボタン + range スライダー (`APP_ZOOM_MIN`〜`APP_ZOOM_MAX`、step `APP_ZOOM_STEP`)。端点で disabled、リセットボタンは既定値との差が < 1e-6 のとき disabled。説明文に「ターミナル個別フォントズーム (⌘+ / ⌘− / ⌘0) と独立で併用可能」を明記
- **renderer/components/ChatPane/ChatInput.tsx**: `useChatSettings` を import、textarea の `fontSize: 13.5` ハードコードを `chatSettings.fontSize` に置換。textarea 高さ自動計算 `useLayoutEffect` の依存配列に `chatSettings.fontSize` を追加（フォントサイズ変更時に line-height 換算が変わるため即時 re-fit が必要）
- **renderer/components/ChatPane/MessageBubble.tsx**: `useChatSettings` を import、`bubbleStyle` 内の `fontSize: 13.5` を `chatSettings.fontSize` に置換し useMemo deps に追加
- **`.claude/CLAUDE.md` §8 T2-10**: 「カスタマイズ拡張」の説明を新仕様に更新。`AppSettings` の構成を `terminal / editor / chat / general` に拡張、`appZoomFactor` を一般設定に追加、フォントズームを「viewMode に応じて cli → terminal.fontSize / md → editor.fontSize / chat → chat.fontSize に分岐するグローバル設定直接更新」と再記述、アプリ全体ズームを「preload 経由 webFrame.setZoomFactor で適用、50%〜200%、ターミナル個別ズームと独立併用可」と追記
- **新規テスト 4 件 (`shared/__tests__/settings.test.ts`)**:
  - `merges chat patch and clamps fontSize`: 下限 1 → 10 / 上限 999 → 28 / 範囲内 16 → 16 を確認
  - `merges general.appZoomFactor and clamps to APP_ZOOM bounds`: 下限 0.1 → 0.5 / 上限 5 → 2.0 / 範囲内 1.25 → 1.25 を確認
  - `falls back appZoomFactor to default for non-numeric values`: `"big"` → DEFAULT
  - `validateAppSettings restores chat defaults for malformed chat block`: `"garbage"` → `DEFAULT_SETTINGS.chat`
- **既存テスト更新**: `mergeSettings` の `base` AppSettings に `chat: { ...DEFAULT_SETTINGS.chat }` を追加（必須フィールド追加に伴う TS エラー解消）
- **テスト合計**: 37 ファイル / 514 件グリーン（修正前 510 から +4 件）+ `npm run build` 通過
- **設計判断**:
  - **アプリ全体ズームを `webFrame.setZoomFactor` 経由にした理由**: CSS `zoom` / `transform: scale` ではターミナルの ResizeObserver / xterm.fit と整合せず cols/rows が乖離しやすい。`webFrame.setZoomFactor` は Chromium がレンダリング全体に均一スケールを適用するため CSS 計算値（getComputedStyle 等）を含めて綺麗に拡縮される。Electron の標準 zoom 機構なのでメインプロセスを介さずに preload から直接呼べるのも利点
  - **preload で webFrame を直接呼ぶ vs Main 経由 IPC**: contextIsolation 下でも preload は Electron API にフルアクセスできるため、ズーム適用のような副作用なし・即時 setter は preload で完結させた方がレイテンシゼロで簡潔。ウィンドウ間の同期も不要（各ウィンドウが独立して同じ settings を購読する設計のため、自然に揃う）
  - **viewMode 分岐 vs ペイン別 fontSize**: 「Chat ペインだけ大きく / MD ペインだけ小さく」というユースケースは現状想定されないため、各タイプ共通のグローバル設定を更新する形にした。既存ターミナルの挙動と一貫し、Settings UI のスライダーと常に同期する利点も継承
  - **chat fontSize は本文（バブル + 入力欄）のみに適用、ステータスバー等は据え置き**: チャット UI 内には fontSize ハードコードが多数（ステータスバー / Welcome / Trust Panel / SlashMenu 等）あるが、これらは補助 UI で本文ではない。Cmd+= で本文のみ拡縮するのがユーザー期待（メッセージを読みやすくしたい）に合致し、補助 UI まで拡縮するとレイアウト崩れリスクが上がる
  - **ChatInput の textarea 高さ依存に fontSize を追加**: useLayoutEffect が `[value]` のみ依存だと、フォントサイズだけ変わって `value` が同じケース（拡大直後など）に高さ再計算が走らず、line-height ベース計算と実際の表示にズレが出る。依存追加で初回拡縮直後から正しい高さに収束
  - **アプリ全体ズームの範囲を 0.5〜2.0 に絞った理由**: Electron の webFrame は 0.25〜5.0 を許容するが、0.25 ではトラフィックライト等の OS UI と崩れ、3.0 以上ではターミナルの cols が 10 を切って実用にならない。実用域として 50%〜200% に限定
  - **既存ターミナル挙動の互換性維持**: `viewMode === "cli"` または `null`（ペイン未確定）時は元の `terminal.fontSize` 更新ロジックを完全保持。`Cmd+0` の reset 値も既存の 14 を踏襲（`DEFAULT_SETTINGS.terminal.fontSize=13` との差は旧仕様からの引き継ぎで、エディタ/チャットだけ DEFAULT_SETTINGS から値を取る）
  - **General settings タブで完結 vs ショートカット追加**: ユーザー要望「Settings の場所は一般タブで OK」に従い、ショートカットは追加せずスライダー + ボタンのみ。後日要望があればショートカット ID `app-zoom-in/out/reset` を追加できるよう registry を拡張可能な状態に保つ
