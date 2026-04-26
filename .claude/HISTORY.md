# HISTORY.md - 変更履歴

### 2026-04-26 - プロンプトドット成功/失敗カラー反映バグ修正

#### 概要

「(base) の左横の丸マーク（プロンプトドット）でコマンド成功/失敗の色変化が機能していない」バグを修正。根本原因は `terminalManager.ts` の OSC 7770 `A` ハンドラが、precmd → `D;N` で打ったばかりの色付き● decoration を直後の zle-line-init → `A` で即 `dispose()` していたこと。zsh の発火順序が「precmd → 新プロンプト描画 → zle-line-init」なため、ユーザ視点では「コマンド完了瞬間に一瞬だけ色付き → 新プロンプト到達と同時にグレーに戻る」となり、視覚上は色が一切変化しないように見えていた。修正は `A` ハンドラの `decoration?.dispose()` 呼び出しを削除し、過去 decoration はそのまま残して xterm.js の scrollback 上限到達時の自動 dispose に委ねる方式に変更。これにより iTerm2 / VSCode の semantic prompt 慣習通り、過去プロンプトの ● が成功=緑 / 失敗=赤 で視覚的に保持される。

#### 変更点

- **terminalManager.ts (OSC 7770 A ハンドラ)**: `inst.promptDot.decoration?.dispose()` 行を削除し、新マーカー差し替え時に過去 decoration の参照だけ捨てる動作に変更。理由を 7 行のコメントで明記（precmd → A の発火順序、ユーザに色変化が見えなくなる症状、xterm.js の scrollback 連動 dispose に委ねる根拠）
- **terminalManager.test.ts (回帰テスト追加)**: 「`A` ハンドラが直前 decoration を破棄しないこと」を保証する it ブロックを追加。`oscHandler("A")` → `oscHandler("D;0")` で decoration を打ったあと、再度 `oscHandler("A")` を呼んでも `decorationMock.dispose` が呼ばれないこと、`promptDot.decoration` 参照だけが null に差し替わることを検証
- **テスト合計**: 22 ファイル / 290 件グリーン（terminalManager.test.ts は 41 → 42 件に）
- **設計判断**:
  - 過去 decoration を明示 dispose しない方針への切替: メモリリークは発生しない。xterm.js は scrollback 上限超過で marker を自動 dispose し、それに連動して decoration も破棄される。明示管理する利得より、ユーザが成功/失敗色を視認できないバグの方が遥かに大きい
  - シェル側の `__td_prompt_status`（zsh）/ `__td_prompt_command`（bash）はグレー● の常時表示を担当する役割で変更不要。Renderer 側 decoration が「グレー●の上に色付き●を被せる」レイヤーモデルは維持
  - 同セッションで Settings UI 関連の WIP（`terminalManager.ts` の `XtermTheme` 型 import / `updateTheme`/`updateAllThemes` シグネチャ変更等、計画書 `2026-04-26-settings-feature.md`）と本バグ修正が同一ファイルに混在。task-tracker は計画書アーカイブなしのため `.claude/` のみコミット、コード変更は Settings UI 完了時にまとめて or 個別 fix コミットでユーザーが判断する方針

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

> 2026-04-26 ローリングアーカイブ: これ以前の 25 エントリは [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。
