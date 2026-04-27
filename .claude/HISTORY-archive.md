# HISTORY-archive.md - 変更履歴アーカイブ

HISTORY.md のローリングアーカイブ。エントリが 5 件を超えた際に古いものをここへ移動する（降順、最新が先頭）。

### 2026-04-26 - ペインヘッダー強調 + スクロールバック削除メニュー（T2-9）（計画書: archive/2026-04-26-clear-scrollback-options.md）

#### 概要

各ペイン上部のサブヘッダーを高さ 22px → 28px に拡張し、SF Pro Display 系フォント / 太字（folder=600, paneNumber=700）/ tabular-nums で視認性を強化。あわせてサブヘッダー高さ変更に伴い `TerminalPane` のコンテンツ領域 `calc(100% - 22px)` が `calc(100% - 28px)` から外れて active ペインのオレンジフォーカス枠（bottom）が見えなくなる回帰を修正。さらに既存「スクロールバッククリア」アイコンをポップオーバー化し、`ContextMenu` 経由で「すべてクリア / 直近 100・500・1000 行を残す / 完全リセット（danger）」の 5 項目を提示。部分削除は `terminal.options.scrollback` を一時的に keepLines まで下げて trim を発火 → `queueMicrotask` で元の上限へ戻す方式で、PTY / シェル状態には触れない既存の `clearScrollback` ポリシーと整合させた。完全リセットは `terminal.reset()` + `clearTextureAtlas()` で xterm 側の状態（カーソル形状・モード・代替バッファ・選択・スクロールバック）のみ初期化する最終手段として用意。

#### 変更点

- **TerminalSubHeader.tsx (ヘッダー強調)**: ルート div を高さ 22→28px、padding `0 8px → 0 10px`、gap 6→8px、fontSize 11→12px に変更。fontFamily に `"SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` を明示し letterSpacing 0.02em / fontWeight 500 を追加。paneNumber は fontWeight 700 / fontSize 13px / `fontVariantNumeric: tabular-nums` で番号の幅ブレを防止。folderName は textColor を `theme.colors.text` に格上げ + fontWeight 600、processDisplay は fontWeight 500、CLI / MD タブはアクティブ時 fontWeight 700・非アクティブ 500 に。アイコンボタンサイズも 18→20px に拡張
- **TerminalPane.tsx (フォーカス枠 bottom 修正)**: 内側コンテンツ領域の `height: calc(100% - 22px)` を `calc(100% - 28px)` に追従。サブヘッダー高さ変更で 6px はみ出して `.terminal-container` の `border: 3px solid activeTerminal` の bottom が見えなくなっていた回帰を解消
- **terminalManager.ts (scrollback API 拡張)**: `trimScrollback(id, keepLines)` を新規追加。`terminal.options.scrollback` を一時的に keepLines に下げて xterm の BufferService に古い行 trim を発火させ、`queueMicrotask` で元値へ戻す（恒久的な上限変更ではない）。`registry.get(id) !== instance` のレース対策ガード付き、`keepLines >= original` / 負数 / NaN は no-op。`resetTerminal(id)` も新規追加し `terminal.reset()` + `terminal.clearTextureAtlas()` で xterm 側の状態を完全初期化（PTY / シェル状態は不変）。既存 `clearScrollback` の JSDoc に「全消去版」「部分削除は trimScrollback、完全リセットは resetTerminal」を追記
- **TerminalSubHeader.tsx (削除メニュー)**: ゴミ箱アイコンをクリックすると `e.currentTarget.getBoundingClientRect()` の `(left, bottom + 4)` をアンカーに `ContextMenu` をポップオーバー表示。`useState<{ x: number; y: number } | null>` で開閉管理、aria-haspopup / aria-expanded を付与。メニュー項目は「すべてクリア（プロンプト行は保持）」「直近 100/500/1000 行を残す」「完全リセット」（separator 上、`danger: true`）の 5 件で、それぞれ `clearScrollback` / `trimScrollback(id, n)` / `resetTerminal(id)` を呼ぶ。`ContextMenu` は既存 `Sidebar/ContextMenu.tsx` を相対 import で再利用（ファイル移動は別 PR の責務に分離）
- **新規テスト**: `terminalManager.test.ts` の MockTerminal に `reset` mock と `scrollback` 付き `options` 型を追加。`trimScrollback` のテスト 4 件（同期で scrollback 下がる + microtask で復帰 / `keepLines >= original` no-op / 負数・NaN・Infinity no-op / 未知 id no-op）と `resetTerminal` のテスト 2 件（reset + clearTextureAtlas が 1 回ずつ呼ばれる / 未知 id no-op）を追加
- **テスト合計**: 22 ファイル / 291 件グリーン（修正前 285 から +6 件）
- **ドキュメント更新**: `CLAUDE.md` Tier 2 に T2-9（スクロールバック削除メニュー）を追記。`docs/requirements/tier-2-supporting.md` に T2-9 詳細（Purpose / Boundary / Acceptance Criteria）を追加
- **設計判断**:
  - ヘッダー強調は「文字を太く + 行高を上げる」のみで色相を増やさず、既存テーマの contrast 体系を壊さない最小路線。SF Pro Display を明示するのは macOS 上で `-apple-system` がサイズ閾値で SF Pro Text/Display を切り替える挙動を 12px サイズで Display 寄りに固定するため
  - フォーカス枠 bottom 消失は新規バグではなく、`TerminalPane` 側の `calc(100% - 22px)` が「サブヘッダー高さの参照」を文字列リテラルで持っていたために起きた典型的なマジックナンバー乖離。今回は最小修正に留め、共通定数化は別 PR の責務とする
  - `trimScrollback` の microtask 復帰モデルは「sync で trim を発火 → 即座に上限を戻す」ことで、(a) 一時的な上限変更が他のクリア API と競合せず (b) 今後の出力で再び 10000 行まで蓄積できる挙動を両立。同一フレームでの連打は ContextMenu が 1 クリックで閉じる仕様に守られているため実質発生しない
  - `resetTerminal` はクリア系の最終手段として「PTY 状態に触れない / シェル履歴は維持 / 表示崩れだけを根絶」のポリシーで設計。`terminal.reset()` 単体だとカーソル形状などのモード状態だけが戻り表示は残るケースがあるため `clearTextureAtlas()` を併用
  - `ContextMenu` は `Sidebar/` 配下のままにし、`TerminalSubHeader` から相対 import で再利用。共通化のためのファイル移動は単独 PR の責務とすることで、本変更の差分を最小化
- **計画書アーカイブ**: `.claude/archive/2026-04-26-clear-scrollback-options.md` に Status=COMPLETED で移動済み

### 2026-04-26 - ペイン内 Markdown エディタ（T2-8、CodeMirror 6）（計画書: archive/2026-04-26-markdown-editor.md）

#### 概要

サイドバーから `.md` / `.markdown` ファイルを開き、ターミナルペイン内で編集できる機能を追加。CLI と MD は同じ leaf の 2 ビューとして扱い、レイアウト型は変更せず `terminalMetaStore` に `viewMode: "cli" | "md"` と MD 状態（filePath / savedContent / dirty / loadedAt）を持たせる。MD 表示中も xterm/PTY は `display:none` で生存し、CLI に戻るとバッファ・カーソル位置・スクロール位置が完全に保たれる。CodeMirror 6（@uiw/react-codemirror + lang-markdown）を採用、Cmd+S 明示保存 / Cmd+Z・Cmd+Shift+Z による履歴は MD pane focus 時に App.tsx capture-phase keydown を bypass して CodeMirror に委譲。トリガはサイドバー右クリック → 「編集する」項目（`.md` / `.markdown` のみ表示）→ ペイン番号確認モーダル。dirty 状態でのタブ切替・別ファイル・MD タブ × ・Cmd+W には未保存警告モーダル（保存して続行 / 破棄して続行 / キャンセル、default focus はキャンセル）。MD 状態自体はセッション永続化対象外（再起動時は CLI に戻る）。

#### 変更点

- **依存追加**: `@uiw/react-codemirror` / `@codemirror/lang-markdown` / `@codemirror/commands` / `@codemirror/state` / `@codemirror/view`（@uiw 経由で basicSetup の history / searchKeymap / lineNumbers を有効化）
- **IPC 追加**: `fs:readFile` / `fs:writeFile`（utf-8 固定、5MB 上限、`validatePath` 適用）。`file-system-handler.ts` に `readTextFile` / `writeTextFile`、preload に `window.api.fs.readFile/writeFile`
- **terminalMetaStore 拡張**: `viewMode` / `mdFilePath` / `mdSavedContent` / `mdDirty` / `mdLoadedAt` フィールドと `openMarkdown` / `setViewMode` / `setMdDirty` / `markMdSaved` / `clearMarkdown` actions を追加。`initMeta` / `initLeafMeta` / `hydrateMetas` のデフォルトは `viewMode: "cli"`。`mdLoadedAt` は同一ファイル再オープン時の MarkdownEditor remount トリガ
- **新規コンポーネント**: `MarkdownEditor.tsx`（CodeMirror 6 ラッパ、`Mod-s` keymap で内部 save、`data-md-editor-pane` 属性で焦点判定、テーマ追従の `EditorView.theme()`）/ `OpenMarkdownModal.tsx`（番号強調の確認モーダル、Enter 確定 / Esc キャンセル）/ `UnsavedChangesModal.tsx`（switch-to-cli / open-other / close-pane の 3 reason、default focus はキャンセル）
- **新規 service / store**: `services/markdownEditorRegistry.ts`（per-pane imperative API: getContent / save / focus）/ `stores/markdownDialogStore.ts`（モーダル要求の中央集約 store、コールバックを request に格納する single-active モデル）
- **新規 utility**: `utils/markdownFile.ts`（`isMarkdownPath` / `getFileName`、case-insensitive）。`utils/layoutUtils.ts` に `collectPaneIdsInOrder` / `getPaneNumber` を追加し、SplitContainer のローカル DFS 関数を共通化
- **TerminalPane.tsx**: `viewMode === "md"` のとき MarkdownEditor を `position: absolute` で前面表示し xterm コンテナを `display: none` に。`key={mdFilePath}#${mdLoadedAt}` で remount をトリガ
- **TerminalSubHeader.tsx**: `mdFilePath` 設定時にペイン番号の右隣に `[CLI] [<filename>●] [×]` のタブ風 UI。dirty 時は `●`、× ボタンと CLI タブクリックは dirty 時に未保存警告を経由。filePath 未設定時は従来の「フォルダ名 | プロセス」表示を維持
- **DirectoryTree.tsx**: `buildMenuItems` に「編集する」項目を追加（`.md` / `.markdown` のみ条件表示）。`onRequestEditMarkdown` props を Sidebar 経由で App から受け取る
- **App.tsx**: モーダル状態を `markdownDialogStore` 経由で render、`handleRequestEditMarkdown(filePath)` で `activeTerminalId` の dirty チェック → 必要なら未保存警告 → 確認モーダル → ファイル読込 → `openMarkdown`。Cmd+W ガードで MD pane の dirty 時に `UnsavedChangesModal (close-pane)` を表示。Cmd+Z / Cmd+Shift+Z は `data-md-editor-pane` 内 focus のとき `return` して CodeMirror history に委譲
- **新規テスト**: `utils/__tests__/markdownFile.test.ts`（17 件、case-insensitive / 拡張子バリエーション / null/undefined ガード / ドット位置エッジケース）/ `utils/__tests__/layoutUtils.test.ts`（10 件、`collectPaneIdsInOrder` / `getPaneNumber` の DFS 順 / 不存在 ID）/ `stores/__tests__/markdownDialogStore.test.ts`（5 件、show / dismiss / single-active 置換）。テスト合計 22 ファイル / 285 件グリーン
- **ドキュメント更新**: `CLAUDE.md` Tier 2 に T2-8 を追記、`docs/requirements/tier-2-supporting.md` に Purpose / Boundary / Acceptance Criteria / Dependencies を追加
- **設計判断**:
  - レイアウト型 (`TerminalPane`) は変更せず per-pane viewMode で表現することで、PTY ライフサイクル・SplitContainer の DFS / paneNumber 計算・セッション永続化への影響を最小化
  - MarkdownEditor の content state は CodeMirror 内部に閉じ込め、外部からは `markdownEditorRegistry` の imperative API（save / getContent / focus）でのみアクセス。Zustand に doc を保持しないことで毎キー入力の再 render を回避
  - モーダル要求の中央集約は context や prop drilling ではなく Zustand store にコールバックを格納する形を採用。Sidebar / TerminalSubHeader / Cmd+W ハンドラから配線レスで `showOpenConfirm` / `showUnsaved` を呼べる
  - 同一ファイル再オープン時の stale doc 表示を避けるため、`mdLoadedAt` カウンタを key に含めて MarkdownEditor を remount。`useState(() => initialValue)` の初期値固定パターンと整合
  - `isInsideMarkdownEditor()` は `target.closest('[data-md-editor-pane]')` で検出。activeTerminalId ベースだと editor focus 直前のフレームで判定がズレるため、DOM 親探索のほうが堅牢
- **計画書アーカイブ**: `.claude/archive/2026-04-26-markdown-editor.md` に Status=COMPLETED で移動済み

### 2026-04-26 - ウィンドウごと独立テーマ（テーマ同期解除）

#### 概要

複数ウィンドウを開いた際、各ウィンドウが独立したテーマを持てるように変更。従来は localStorage 共有 + `theme:sync` IPC ブロードキャストで全ウィンドウのテーマが強制同期されていたが、これを完全廃止。新規ウィンドウは常に DEFAULT_THEME_ID（dark）で起動し、テーマ選択はそのウィンドウが開いている間だけメモリ上に保持する（再起動で失われる）。

#### 変更点

- **themeStore**: `getStoredThemeId` / `storeThemeId` / `setupThemeSync` を削除し、初期値を `DEFAULT_THEME_ID` リテラルに固定。`setTheme` から `window.api.theme.notifyChanged` 呼び出しを削除（純粋な local state 更新のみ）。localStorage 永続化は廃止
- **App.tsx**: `setupThemeSync` の import と `useEffect(() => setupThemeSync(), [])` を削除
- **IPC 削除**: `ipc-handlers.ts` の `theme:changed` ハンドラ、`preload/index.ts` の `window.api.theme` ネームスペース全体（`notifyChanged` / `onSync`）を削除
- **未使用化したユーティリティ削除**: 唯一の利用箇所（theme:changed ハンドラ）を消したため未使用となった `pty-manager.broadcastToAll` を削除。関連テスト 3 件も削除
- **テスト・モック更新**: `renderer/test/setup.ts` から `mockThemeApi` を削除。`themeStore.test.ts` の localStorage 永続化テスト 3 件を削除（254 → 253 件、すべてグリーン）
- **テスト合計**: 19 ファイル / 253 件グリーン
- **設計判断**:
  - 「各ウィンドウの最後のテーマを覚える」にすると `session-state.json` を multi-window 対応に拡張する必要があり、既存の "最初の 1 ウィンドウだけが復元データを受け取る" 設計との整合に重大な改修が必要。今回は「再起動で全ウィンドウ dark から始まる」最小路線を採用
  - 新規ウィンドウのテーマを「親ウィンドウから継承」ではなく「常に dark」にする選択は、ユーザーの明示的な指定（B 案）。Dock の「最近のディレクトリ」経由で開いた追加ウィンドウも同じ挙動
  - `broadcastToAll` は generic な utility だが、唯一の caller を消した時点で dead code 扱い。"unused なら削除" の方針に従い除去（将来必要になれば再追加可能）

### 2026-04-25 - Cmd+F 検索パネル機能拡張（VSCode 風オプション + ヒット件数）+ スクロールバッククリアボタン

#### 概要

ペインごとの Cmd+F 検索オーバーレイに VSCode 相当の検索オプション（Case sensitive / Whole word / Regex）とヒット件数表示（`3 / 12` / `件超` / `見つかりません` / `正規表現が不正です`）、入力欄編集ショートカット（Cmd+Backspace で全クリア / Cmd+←→ で行頭・行末移動）を追加。`SearchAddon.onDidChangeResults` を `terminalManager.subscribeSearchResults` 経由で購読し、クエリ・オプション変更で `findNext` を再実行（`incremental: true` で現在マッチ位置を保持）して装飾とカウンタを同時更新。あわせて `TerminalSubHeader` 右側にゴミ箱アイコンの「スクロールバッククリア」ボタンを追加し、`terminal.clear()` + `clearTextureAtlas()` でバッファ削除と canvas テクスチャ腐敗の強制再描画をワンタッチ実行できるようにした（PTY・シェル状態は不変）。

#### 変更点

- **terminalManager 検索 API 拡張**: `findNext` / `findPrevious` の第3引数に `SearchOptions { caseSensitive, wholeWord, regex, incremental }` を追加。`buildSearchOptions` で `ISearchOptions` 形に変換、装飾は既存 `SEARCH_DECORATIONS` を強制適用。`subscribeSearchResults(id, listener)` を新設し `SearchAddon.onDidChangeResults` を unsubscribe 関数付きで露出
- **terminalManager クリア API**: `clearScrollback(id)` を新設。`terminal.clear()`（プロンプト行を新先頭にしてバッファ削除）+ `terminal.clearTextureAtlas()`（macOS スリープ復帰時の表示崩れ等のテクスチャ腐敗を強制再描画）を順に呼ぶ。registry 未登録 id は no-op
- **TerminalSearchOverlay UI 拡張**:
  - 入力欄右に `Aa` / `Ab` / `.*` の 3 トグル（active 時は accent 色塗り）。`searchOptions` を `useMemo` で安定化
  - クエリ・オプション変更を監視する `useEffect` で `findNext(..., { ...searchOptions, incremental: true })` を再実行し装飾を refresh、空クエリ時は `clearSearchDecorations` でリセット
  - `regexInvalid` state を `new RegExp(query)` の try/catch で更新し、不正時は赤枠 +「正規表現が不正です」表示で `runFind` を抑止
  - ヒット件数表示: `resultIndex+1 / resultCount`（threshold 超は `resultCount` 件超、ヒット 0 は「見つかりません」、空クエリは「Tab: Path」）
  - `handleKeyDown` に `Cmd/Ctrl + Backspace` → 入力全クリア、`Cmd/Ctrl + ArrowLeft` → `setSelectionRange(0, 0)`、`Cmd/Ctrl + ArrowRight` → 末尾移動を追加（Electron で input 内ショートカットが効かない問題への明示対応。path モードでも動作）
- **TerminalSubHeader クリアボタン**: 既存「ファイル挿入」ボタンを共通 `iconButtonStyle` 化し、その左にゴミ箱 SVG の「クリア」ボタンを追加。tooltip「スクロールバックをクリア（プロンプト行は保持）」、aria-label 設定。`onClick` で `terminalManager.clearScrollback(id)` を呼ぶ
- **新規テスト**: `terminalManager.test.ts` の MockTerminal に `clear` / `clearTextureAtlas` mock を追加し、`clearScrollback` の単体テスト 2 件（呼び出し検証 + 未登録 id ガード）を追加
- **テスト合計**: 19 ファイル / 259 件グリーン（修正前 257 から +2 件）
- **設計判断**:
  - `incremental: true` を refresh effect 側だけ渡すことで「タイプ中は現在のマッチに留まる」UX を実現。Enter / Shift+Enter での明示的なナビゲーションは従来通り次/前のマッチへ進める
  - 件数表示は `resultIndex < 0` を SearchAddon のオーバーフロー（既定 1000 件）として「件超」に倒し、UI を 1 行で完結させる
  - クリアボタンは `terminal.clear()` のみではなく `clearTextureAtlas()` も併用。「バッファ肥大化に伴う表示バグ」要件と xterm.js が公式ワークアラウンドとして提示する canvas 復元処理が一致するため
  - クリア操作は PTY / シェル履歴に触れない。実行中コマンドを保持したまま画面だけリセットする UX が macOS Terminal の Cmd+K 標準と整合

### 2026-04-25 - Follow-up Improvements（起動ログ補強 / 可用性通知 / リファクタ）（計画書: archive/2026-04-25-followup-improvements.md）

#### 概要

直前のコミット `1bef705` 監査で挙げた中規模・大規模タスクのうち、起動ログ問題の補強（A-2/A-5）、可用性通知（B-R2/B-R3/B-R5）、コード整理（B-Q2/B-B2/B-Q1）の 8 件をまとめて実装。`TerminalPane` を `useLayoutEffect` 化して `setTimeout(0)` 依存を排除し、attach → fit → pty.create を同期で確定させる構造に置換。session save 失敗と chokidar watcher 連続エラーは renderer に IPC で通知して toast 表示。multi-window 起動時の復元データ race は `sessionStateManager.consumeRestoreData()` を mutex 化して構造的に解消。`promptDotStates` の二元管理を `TerminalInstance` に統合、`splitTerminal` の metaStore 二度更新を `initLeafMeta` で 1 set にまとめて中間状態のサブスクライバ通知を解消。session-state の検証ロジックを `src/shared/session-state-validator.ts` に SSOT 化し main / preload / renderer から共通参照する形に整理。

#### 変更点

- **A-2 (terminalManager idempotency テスト)**: `terminalManager.test.ts` に「同一 id の `getOrCreate` 二度呼びでもリスナー / OSC ハンドラ / IPC subscriber が重複登録されない」テストを追加（StrictMode 二重マウント耐性の固定化）
- **A-5 (TerminalPane の useLayoutEffect 化)**: `TerminalPane.tsx` の effect を `useEffect` → `useLayoutEffect` に変更。`setTimeout(0)` 経由の attach / fit / pty.create を排除し DOM 反映後・paint 前の同期実行に。テストの fakeTimers 依存も解消
- **B-R2 (session save 失敗 toast)**: `session-state.ts:writeNow` の catch で `BrowserWindow.getAllWindows()` 経由の `session:saveFailed` ブロードキャストを追加。`preload/index.ts` に `session.onSaveFailed` listener、`sessionPersist.ts` で 30 秒 dedup 付き `showErrorToast` を購読。テスト 2 件追加（writeFile throw / 破棄ウィンドウスキップ）
- **B-R3 (chokidar error 閾値通知)**: `file-system-handler.ts` の `WatchEntry` に `errorCount` / `errorWindowStart` を追加し、5 分間で 5 件超えたとき `fs:watcherError` を 1 度だけ送信。`preload/index.ts` に `fs.onWatcherError` listener、`Sidebar.tsx` で toast 表示
- **B-R5 (multi-window restore race の堅牢化)**: `ipc-handlers.ts` のクロージャで管理していた `sessionRestoreConsumed` を `sessionStateManager.consumeRestoreData()` メソッドに移管し同期 mutex 化。テスト 2 件追加
- **B-Q2 (promptDotStates 統合)**: `terminalManager.ts` の module-scope `promptDotStates: Map` を `TerminalInstance.promptDot` に吸収。OSC 7770 ハンドラと `destroy()` を `instance.promptDot` 参照に統一
- **B-B2 (splitTerminal の atomic 化)**: `terminalMetaStore` に `initLeafMeta(id, cwd)` を新設（init + cwd 設定を 1 回の set にまとめる）。`splitTerminal` から `initMeta + setCwd` の二度更新を `initLeafMeta` に置換し、metaStore のサブスクライバ通知が 1 回に。テスト 1 件追加（通知回数の検証）
- **B-Q1 (session-state validator SSOT 化)**: `src/shared/session-state-validator.ts` を新設して型・定数・検証関数を集約。`main/types/session-state.ts` は shared から re-export、`main/session-state.ts` の重複 validation 関数を削除、renderer 側 `sessionRestore.ts` の `deserializeLayout` も shared 関数経由に。`tsconfig.web.json` / `tsconfig.node.json` の include に `src/shared/**/*` を追加、`vitest.config.ts` を shared テスト対応に更新。validation 13 件のテストを `shared/__tests__/session-state-validator.test.ts` に移行
- **テスト合計**: 19 ファイル / 257 件グリーン（修正前 18 / 251 から +1 file / +6 件）
- **設計判断**:
  - `useLayoutEffect` 化は最小修正路線。xterm のリアクティブ DOM 管理化は規模が大きいため将来計画として温存
  - session save 失敗の dedup は renderer 側で 30 秒、エラーメッセージ単位で抑制（メモリ消費は実用上 5-10 件以内で問題なし）
  - chokidar の閾値通知は 5 分 / 5 件。エラーが収束したら次のウィンドウから再カウント（連投で toast が嵐にならない設計）
  - `consumeRestoreData` の mutex は同期 read+write のため race フリー。Dock 経由の追加ウィンドウは `initialCwd` 優先のため呼ばない（既存設計）
  - `initLeafMeta` は `initMeta` の上書き禁止ガードを尊重（既存なら no-op）
  - validator SSOT 化は型互換のため `main/types/session-state.ts` を re-export ファイルに留め、既存 import 経路を維持
- **計画書アーカイブ**: `.claude/archive/2026-04-25-followup-improvements.md` に Status=COMPLETED で移動

### 2026-04-25 - PTY 起動ログ安定化 + IPC セキュリティ強化 + 既知の小バグ修正

#### 概要

ペイン分割直後に新規ペインへ起動ログ（zsh 起動メッセージ・初回プロンプト）が表示されないラックレース問題を、Main 側の per-PTY 初期出力バッファ + renderer reply 後の明示 flush で構造的に解消。あわせて renderer から渡される任意パスを処理する fs / dnd / recentDirs / pty:create / window:create の全 IPC 境界に allow-list ベースのパス検証を入れ、`/etc/passwd` 等のシステム領域への偶発的・悪意的アクセスを遮断。`openInVSCode` のシェル経由 spawn を `shell: false` + argv 配列に置換して command injection を解消、`shell:openExternal` の URL 検証を `URL` parser ベースに強化、node-pty 環境変数から `NODE_OPTIONS` / `LD_PRELOAD` / `DYLD_*` を除外、CSP meta タグを追加。さらに PTY spawn 失敗をサイレントに残さないため renderer 側で toast 通知、splitTerminal が CWD 未設定の親から作られたとき新ペインの meta が未初期化のまま残るバグを修正、chokidar `unwatch` で破棄済みウィンドウの ID を掃除して watcher が孤立しない実装に。

#### 変更点

- **PTY 起動バッファ (Main)**: `pty-manager.ts` の `PtyProcess` に `initialBuffer` / `bufferingActive` を追加。`pty.spawn()` 直後の `onData` は buffer に蓄積し、64KB 超で auto-flush。新規 `flushInitialBuffer(id)` を export
- **PTY 起動バッファ (IPC / Preload)**: `ipc-handlers.ts` に `pty:flushInitialBuffer` ハンドラ、`preload/index.ts` に `window.api.pty.flushInitialBuffer` を追加
- **PTY 起動バッファ (Renderer)**: `TerminalPane.tsx` の `pty.create.then` で resize 直後に `flushInitialBuffer(id)` を呼び出し、リスナー登録準備完了の合図に。`pty:data` リスナーは `getOrCreate` 内で同期登録済みのため取りこぼしなし
- **IPC パス allow-list (新規)**: `src/main/path-validator.ts` に `validatePath` を実装。許可境界はホーム配下 / `/Volumes/` / `/tmp/` / `/private/tmp/` / `/var/folders/` / `/private/var/folders/`。それ以外は `null` を返す
- **IPC パス allow-list (適用)**: `ipc-handlers.ts` の `fs:readDir` / `fs:watch` / `fs:unwatch` / `fs:rename` / `fs:moveToDir` / `fs:trash` / `fs:trashWithTracking` / `fs:restoreFromTrash` / `fs:movePath` / `fs:copyPath` / `fs:openInVSCode` / `dnd:startDrag` / `recentDirs:add` / `pty:create`(initialCwd) / `window:create`(initialCwd) すべてに `validatePath` を適用。`fs:rename` は出来上がりパスも再検証
- **shell injection / URL / env 強化**: `file-system-handler.ts:openInVSCode` を `spawn("code", [path], { shell: false })` に変更。`ipc-handlers.ts:shell:openExternal` を `new URL()` parse + `protocol === "http:" / "https:"` チェックに変更。`pty-manager.ts` の `cleanEnv` から `NODE_OPTIONS` / `LD_PRELOAD` / `DYLD_INSERT_LIBRARIES` / `DYLD_LIBRARY_PATH` を deny-list で除外
- **CSP**: `src/renderer/index.html` に `Content-Security-Policy` meta タグを追加（default-src 'self'、style-src 'unsafe-inline'、xterm.js / Vite HMR のため script-src に 'unsafe-eval' は許可）
- **PTY spawn 失敗の可視化 (Renderer)**: `TerminalPane.tsx` の `pty.create` resolve 値が `false` の場合 / catch 経路の両方で `showErrorToast` を呼び、xterm 内にも赤字メッセージを表示。新規 IPC 不要（既存戻り値を使用）
- **splitTerminal の meta 初期化保証**: `terminalStore.ts:splitTerminal` で `sourceCwd` の有無に関わらず `metaStore.initMeta(newTerminalId)` を必ず呼ぶ。CWD 未設定の親ペインから分割した際にメタ未初期化のまま PTY 起動 → 想定外の `window.initialCwd` フォールバックに落ちるバグを解消
- **chokidar watcher 掃除**: `file-system-handler.ts:unwatch` で `BrowserWindow.fromId` が destroyed の windowId を `entry.windowIds` から除去。空になった場合は強制 close する防衛経路を追加
- **新規テスト**:
  - `__tests__/path-validator.test.ts` 17 件（許可境界 / 拒否 / path traversal / sibling-prefix / 非文字列入力 / 正規化）
  - `__tests__/pty-manager.test.ts` に initial buffer / flush ケースを 6 件追加（buffering 中の no-send / flush 後の通常モード / 二度目 flush no-op / 64KB auto-flush / 非存在 id no-op）
  - `__tests__/terminalStore.test.ts` に splitTerminal の meta 初期化検証 2 件追加（CWD なし時 / CWD ありの継承）
- **既存テスト修正**: `pty-manager.test.ts` の onData 系既存ケースは buffering 前提に合わせて `flushInitialBuffer` を先に呼んでから data callback を発火する形に修正。`renderer/test/setup.ts` の `mockPtyApi` に `flushInitialBuffer` を追加
- **テスト合計**: 18 files / 251 件グリーン（修正前 17 / 226 から +1 file / +25 件）
- **設計判断**:
  - PTY 起動ログ問題は IPC 競合よりも「リスナー登録準備完了の合図がなく Main 側が早すぎて吐く」構造が真因。invoke の reply を「準備完了通知」として再利用することで、追加の handshake IPC を増やさず構造的に解決
  - パス検証は ALLOW プレフィックスを明示。許可境界外は null で弾き、UX を壊さない範囲（外部ボリューム・macOS 一時領域）は明示的に許可。symlink 経由のエスケープは realpath を取らないため検出しない（明白な path traversal を止める防御線として位置付け）
  - PTY spawn 失敗通知は新規 IPC を増やさず、`pty.create` の boolean 戻り値を判定するだけにすることで実装を最小化
  - splitTerminal の修正は既存の `initMeta` の idempotent 設計（既存なら no-op）を尊重したまま「呼ぶこと自体を必須化」する形に倒すことで、後方互換と保守性を両立
  - chokidar の windowIds 掃除は `unwatch` の通常経路にもガードを入れる二層防御。`unwatchAllForWindow` が既存にあるが、ウィンドウが先に destroy された race のフォロー

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
  - `services/terminalManager.ts`: `SearchAddon` ロード、`findNext` / `findPrevious` / `clearSearchDecorations` を export。`pty:onData` で ALT screen 以外なら `feedPathHistory` に流す。ANSI escape を除去し改行ごとに `extractPaths` でパスを抽出(持ち越しバッファ上限 8KB / 行長 4KB ガード)。`destroy()` で `pathHistoryStore.removePane` と `pathBuffers.delete` を追加
  - `components/TerminalPane.tsx`: `useSearchOpenForPane` で `TerminalSearchOverlay` を条件レンダリング
  - `App.tsx`: 既存 capture-phase keydown ハンドラに Cmd+F(toggle search)と Cmd+R(refresh sidebar、常時 preventDefault)を追加
  - `stores/fileTreeStore.ts`: `refreshAllExpanded(rootPath)` を追加。`sidebarStore.expandedPaths` から当該ルート配下の展開中パスを集め `Promise.all` で並列再ロード
  - `components/Sidebar/Sidebar.tsx`: `selectedTabCwd` 変更時に `refreshAllExpanded` を発火(タブ切替時の自動再読み込み)
  - `components/Sidebar/UndoRedoToolbar.tsx`: Refresh ボタン追加(spinner state は `isRefreshing` で disabled)
  - `components/Sidebar/icons.tsx`: `RefreshIcon` を追加
  - `components/ShortcutsModal.tsx`: `⌘ F`(ペイン内検索 / パス履歴)と `⌘ R`(ディレクトリツリー再読み込み)を追記
- **新規テスト**: `pathHistoryStore.test.ts`(7 件)/ `terminalSearchStore.test.ts`(5 件)/ `fileTreeStore.test.ts`(3 件)。190 / 190 グリーン
- **設計判断**:
  - パス挿入は既存 D&D と同じ直接 `pty.write(formatPaths(...))` パターンに揃える(Cmd+Z 行 Undo の対象外)
  - Cmd+R はサイドバー閉時にも常に preventDefault(dev で webContents.reload を防ぐため)
  - 相対パス抽出は CWD が判明している時のみ。`http://`/`https://` は除外
  - パス履歴の重複は末尾スラッシュ正規化キーで吸収。同一 raw 再観測時は count++ + lastSeenAt 更新
  - 検索オーバーレイ開閉は同時 1 ペインに限定し、複数オーバーレイ並列を許さない(フォーカス競合を防ぐ)
  - 既存 chokidar watch は維持。手動 refresh は chokidar が unwatch 中(タブ切替で release)に取り逃した変更を補完する位置付け

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
