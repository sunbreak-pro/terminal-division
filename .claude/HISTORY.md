# HISTORY.md - 変更履歴

### 2026-04-29 - T2-10 カスタマイズ拡張（フォント / カーソル / シェル / エディタ / 通知）

#### 概要

ユーザー要望の「フォントの拡大・縮小機能 + 標準ターミナル / AI エディタとして必要なカスタマイズ機能」を一括導入。`AppSettings` を `terminal` / `editor` / `general` の 3 ブロックで拡張し、`SettingsModal` に 3 タブ（ターミナル / エディタ / 一般）を追加。フォントズームはスコープ C（全ペイン共通の永続化グローバル + ペイン毎の揮発オーバーライド）を採用し、`Cmd+=` / `Cmd+-` / `Cmd+0` でアクティブペインのみ ±1px / リセットする iTerm2 互換の振る舞いを実装。グローバル既定値は `settings.terminal.fontSize` で永続化され、新規ペイン作成時の初期値として使われる。フォントファミリー / 行間 / カーソルスタイル + blink / スクロールバック行数 / Bell（none/visual/sound）/ 単語区切り / デフォルトシェル / デフォルト CWD のターミナル設定、フォントサイズ / ファミリー / softWrap の Markdown エディタ設定、セッション復元 ON/OFF / PTY 異常終了通知の一般設定をすべて永続化。`pty:create` IPC は `options: { shell?, defaultCwd? }` 受領に拡張し、`pty-manager.ts` でカスタムシェル指定（実在チェック付き、不在時は `$SHELL` フォールバック）と既定 CWD（`initialCwd` 未指定時のフォールバック）に対応。ペインタイトル手動 rename を `TerminalSubHeader` のダブルクリック inline edit で導入し、`terminalMetaStore` の `customTitle` フィールドが null（CWD 由来の自動表示）と任意文字列を切替。Bell の sound は WebAudio で 880Hz 80ms の短ビープ、visual は 120ms ペインフラッシュ。PTY 異常終了通知は `Notification` API で exitCode != 0 のときだけ発火（許可ダイアログは初回 ON 時に自動要求）。MarkdownEditor は `EditorView.lineWrapping` を `editor.softWrap` で動的トグル。

#### 変更点

- **shared/settings.ts**: `TerminalSettings` / `EditorSettings` / `GeneralSettings` を新規追加。フィールド単位の `validateTerminalSettings` / `validateEditorSettings` / `validateGeneralSettings` と、`mergeSettings` の field-level merge（`base.terminal` を spread して patch をマージ）。クランプ定数 `FONT_SIZE_MIN/MAX` (8/32) / `LINE_HEIGHT_MIN/MAX` (1.0/2.0) / `SCROLLBACK_MIN/MAX` (1000/100000) / `EDITOR_FONT_SIZE_MIN/MAX` (10/32) を export。`clampNumber` ヘルパも export して renderer 側で再利用
- **renderer/stores/settingsStore.ts**: `applyOptimistic` を `terminal` / `editor` / `general` の浅マージ対応に拡張。`useTerminalSettings` / `useEditorSettings` / `useGeneralSettings` セレクタを追加
- **renderer/stores/terminalMetaStore.ts**: `fontSizeOverride: number | null` と `customTitle: string | null` を `TerminalMeta` に追加（揮発、session-persist 対象外）。`setFontSizeOverride(id, value)` / `setCustomTitle(id, value)` action を追加。`initMeta` / `initLeafMeta` / `hydrateMetas` の初期値はすべて null
- **renderer/services/terminalManager.ts**: `applyOptions(id, partial: Partial<ITerminalOptions>)` を新規追加。セルサイズ影響キー（`fontSize` / `fontFamily` / `fontWeight` / `fontWeightBold` / `letterSpacing` / `lineHeight`）の変更時は `invalidateLastSize` + `fit()` で PTY 側にもリサイズを伝える。`subscribeBell(id, listener)` を追加（戻り値で unsubscribe）
- **renderer/components/TerminalPane.tsx**: ハードコードされていた fontSize=13 / fontFamily / lineHeight=1.2 / cursorBlink / cursorStyle / scrollback=10000 をすべて `useTerminalSettings()` 由来に置換。`fontSizeOverride` を購読して `effectiveFontSize = override ?? settings.fontSize` を計算（クランプ付き）。設定変更を購読して `applyOptions` で即時反映する `useEffect` を追加（フォントサイズ変動時は `pty.resize` も発火）。Bell 購読 `useEffect` で visual flash（120ms）/ sound（WebAudio 880Hz 80ms）を実装。`pty.create` 呼び出しに `options: { shell, defaultCwd }` を追加。`onExit` ハンドラを `(exitCode) => void` に拡張し、`general.ptyExitNotification && exitCode !== 0` のとき `Notification` API で macOS 通知
- **renderer/shortcuts/registry.ts**: `font-zoom-in` (Cmd+=) / `font-zoom-out` (Cmd+-) / `font-zoom-reset` (Cmd+0) の 3 ID を追加。`ShortcutCategory` に `Font` を追加（リバインド可能、settings UI のショートカットタブから上書き可能）
- **renderer/App.tsx**: `adjustActivePaneFontSize(paneId, delta)` ヘルパを追加（`getState()` でフレッシュ参照、クランプ付き、no-op early return）。3 ショートカットの handlers を追加。`useSettingsStore.getState().settings.terminal` から起点を読み、`useTerminalMetaStore.getState().setFontSizeOverride()` で per-pane delta を更新
- **renderer/services/terminalManager.ts (TerminalCallbacks)**: `onExit: () => void` → `onExit: (exitCode: number) => void` にシグネチャ拡張（main からの exitCode をパススルー）
- **main/pty-manager.ts (createPty 拡張)**: `customShell?: string` 引数を追加。`fs.existsSync(customShell)` で実在チェックし、不在なら `process.env.SHELL || "/bin/zsh"` にフォールバック
- **main/ipc-handlers.ts (pty:create シグネチャ拡張)**: `options?: { shell?, defaultCwd? }` を受領。`defaultCwd` は `initialCwd` 未指定時のフォールバックとして `validatePath` を通してから `createPty` に渡す
- **preload/index.ts**: `pty.create(id, initialCwd?, options?)` の型拡張
- **renderer/main.tsx (bootstrap)**: 起動時に `settings.get()` と `session.getRestoreData()` を `Promise.all` で並列取得し、`general.restoreSessionOnLaunch` が false なら復元をスキップ（並列化で起動時間影響を最小化）
- **新規 UI: settings/TerminalSettings.tsx**: フォントサイズ slider（範囲 8–32）+ ファミリー preset セレクト（6 種）+ カスタム指定 input + 行間 slider（1.0–2.0）。カーソルスタイル select（block/underline/bar）+ 点滅 toggle。スクロールバック slider（1000–100000、step 1000）+ Bell select + 単語区切り input。デフォルトシェル input + デフォルト CWD input + 「参照」ボタン（`dialog.selectDirectory` を呼ぶ）
- **新規 UI: settings/EditorSettings.tsx**: フォントサイズ slider（10–32、step 0.5）+ ファミリー preset（5 種、比例フォント中心）+ カスタム指定 + softWrap toggle
- **新規 UI: settings/GeneralSettings.tsx**: セッション復元 toggle + PTY 異常終了通知 toggle（初回 ON 時に `Notification.requestPermission` を自動要求）
- **renderer/components/SettingsModal.tsx**: タブを 3 個から 6 個に拡張（外観 / ターミナル / エディタ / ショートカット / ウィンドウ / 一般）
- **renderer/components/TerminalSubHeader.tsx**: ペイン名表示にダブルクリック inline rename を追加。`customTitle` が null なら CWD 由来の `folderName` を表示、文字列なら優先表示。空文字列確定で null に戻して自動表示へ復帰。Enter / blur で確定、Escape でキャンセル
- **renderer/components/MarkdownEditor.tsx**: `useEditorSettings()` 購読を追加。`fontSize: "13.5px"` ハードコードを `editorSettings.fontSize` 由来に、`fontFamily` ハードコードを `editorSettings.fontFamily` に置換。extensions 配列に `editorSettings.softWrap ? [EditorView.lineWrapping] : []` を spread で追加
- **新規テスト 20 件**:
  - `shared/__tests__/settings.test.ts` (+6): terminal/editor/general の merge と clamp、cursorStyle/bellStyle の不正値 fallback、validateAppSettings の terminal block 不正値復元
  - `renderer/stores/__tests__/terminalMetaStore.test.ts` (新規 10 件): initMeta の null 初期化 / 既存 meta の上書き禁止 / setFontSizeOverride（更新・null リセット・no-op・他ペイン無干渉）/ setCustomTitle（文字列 / null クリア / 不在 id）/ hydrateMetas の null 初期化
  - `renderer/services/__tests__/terminalManager.test.ts` (+4): applyOptions の非サイズキーで no fit / サイズキーで refit / undefined 無視 / 未知 id no-op
- **既存テスト更新**: `TerminalPane.test.tsx` の `pty.create` 呼び出しアサーションに第 3 引数 `{ shell: undefined, defaultCwd: undefined }` を追加。`vi.mock` で `useTerminalMetaStore` を関数として callable に拡張（`fontSizeOverride` selector 用）、`useTerminalSettings` / `useEditorSettings` / `useGeneralSettings` の mock を追加（DEFAULT_SETTINGS から返す）。`settings.test.ts` の base AppSettings に terminal/editor/general を spread で含めるように修正
- **テスト合計**: 29 ファイル / 416 件グリーン（修正前 396 から +20 件）
- **CLAUDE.md (§8 Feature Tier Map)**: T2-10 を新規追加し、ターミナル / エディタ / 一般タブの構成、フォントズームの per-pane 揮発オーバーライド、ペインタイトル rename の自動復帰仕様を記載
- **設計判断**:
  - **フォントズームのスコープ C（グローバル + 揮発オーバーライド）**: iTerm2 のメンタルモデルを踏襲。グローバル設定を「新規ペインの初期値」とし、`Cmd+=` / `Cmd+-` でアクティブペインだけ独立調整、`Cmd+0` でグローバルへ戻る。VSCode のような全体共通だけだと「このペインだけ拡大したい」用途に応えられない。per-pane delta は session-persist 対象外（揮発）にすることで、再起動後はフレッシュなグローバル既定で始まる
  - **Cmd+= / Cmd+- / Cmd+0 のキーバインド**: VSCode / iTerm2 / Chrome 等と互換の事実上の業界標準。`registry.ts` に登録することで、ユーザーが `ShortcutSettings` から自由にリバインド可能（例: `Cmd+Shift+=` を好む人のため）
  - **per-pane delta は terminalMetaStore に揮発で持つ**: グローバル設定と同列に永続化すると、ペインを閉じても override 値がストレージに残ってしまい「テストで一度大きくしたまま忘れる」が起きやすい。揮発にすれば session を一旦終わらせれば自然にリセットされる
  - **applyOptions のサイズ影響キー判定 + 自動 refit**: xterm の `options.fontSize` を直接書き換えるとセル幅が変わり PTY の cols/rows が乖離する。`applyOptions` 内で `SIZE_AFFECTING` セットを参照し、該当キーが含まれていれば `invalidateLastSize` → `fit()` を実行して PTY 側にも `pty.resize` を送る（呼び出し側は戻り値の cols/rows で resize する）。これによりフォント変更時の表示崩れを 1 関数で完結
  - **Bell の WebAudio 実装**: ライブラリ依存ゼロ、880Hz 80ms の短ビープを `OscillatorNode` + `GainNode` で生成。`onended` で `AudioContext.close()` してリソース解放。OS の `NSBeep` を使う案もあったが、IPC 経由になるしユーザーが音量調整できないため WebAudio を選択
  - **Bell の visual flash は 120ms で十分**: もっと長くすると入力中に視認性が落ちる。フラッシュは「気づき」の発火点だけ提供し、ユーザーが実際に確認するのは ALT screen やプロンプトで行う前提
  - **PTY 終了通知は Renderer 側の `Notification` API**: main → IPC で `Notification` を出す案もあったが、Renderer 内で完結したほうが (a) ペイン情報（customTitle / processName / cwd）に直接アクセスでき、(b) 許可ダイアログの UX を制御しやすい。`general.ptyExitNotification` トグルで初回 ON 時に `requestPermission()` を発火するため、ユーザーは設定で許可をコントロールできる
  - **PTY 異常終了の判定は exitCode !== 0**: 0 を「正常終了（exit / Ctrl+D）」、非 0 を「異常終了（クラッシュ / 強制 kill）」として macOS 通知の対象にする。Bell とは別軸のため両方有効化しても重複しない
  - **デフォルトシェルの存在チェック + フォールバック**: ユーザーが間違ったパス（例: `/usr/local/bin/fish` だが未インストール）を入れても黒画面で起動失敗にならないよう、`fs.existsSync` で実在チェックし不在なら `$SHELL || /bin/zsh` にフォールバック。pty-manager 側の安全網
  - **デフォルト CWD の優先順位**: 旧来の「メタストア（分割時 CWD）> windowInitialCwd（Dock）> $HOME」の最後に `settings.terminal.defaultCwd` を入れる、ではなく **`initialCwd` が空のときの fallback として ipc-handlers で適用**。これにより Dock や分割からの明示的な CWD は常に優先され、設定の defaultCwd は「何も指定されないとき」だけ効く
  - **セッション復元 ON/OFF を bootstrap で並列読み**: `settings.get()` と `session.getRestoreData()` を逐次にすると起動時間が IPC 2 回分のレイテンシ。`Promise.all` で並列化することで影響を最小化、settings false なら復元データを単に捨てるだけ（拒否する場合の destroy は `session.clear()` を呼ばない — ユーザーが設定を戻せば次回また復元できる）
  - **ペインタイトル rename は customTitle null で自動復帰**: 「rename を解除したい」UX を別ボタンで実装するとサブヘッダーが煩雑になる。空文字列を確定すれば null に戻す扱いにすることで、操作系列が「ダブルクリック → 全消去 → Enter」の 1 フローで完結
  - **MarkdownEditor の softWrap は EditorView.lineWrapping で extension 切替**: CodeMirror 6 の標準パターン。`useMemo` の dep に `editorSettings.softWrap` を含めることで、設定切替時に extensions 配列が再生成され CodeMirror 側が新しい extension を有効化する
  - **EditorSettings のフォントプリセットは比例フォント中心**: ターミナルと違い Markdown は文章中心の用途が多いため、Helvetica / Hiragino / システム既定の sans-serif を上に置き、等幅は下位に。ユーザーが「コード片中心の note を書く」用途では Menlo / JetBrains Mono を選べるようカスタム指定 input も併設
  - **設定タブの並び**: 外観 / ターミナル / エディタ / ショートカット / ウィンドウ / 一般。「外観」を最上位に保つことでテーマ切替の発見可能性を維持し、「ターミナル」を 2 番目に置くことで本アプリの主用途に直結する。「一般」は最下位に置いて「設定全体に影響する大物」を物理的に区別
- **計画書アーカイブ**: `.claude/archive/2026-04-29-customization-features.md` に Status=COMPLETED で移動済み

### 2026-04-27 - サイドバー再帰検索 + 検索フィールド内ショートカット passthrough

#### 概要

サイドバーの検索フィールドが「展開中ディレクトリの兄弟ノードのみ」をフィルタする実装になっていたため、`.claude/MEMORY.md` のように展開していないサブディレクトリ内のファイルが検索クエリ「MEMORY」で全くヒットせず、`ME` まで打っても直下の `README.md` しか出ない問題を修正。Main プロセスに `searchTree(rootPath, query)` を追加し、ルート配下を再帰探索（最大 500 件 / 深度 10、`node_modules` と `.git` のみスキップ、symlink ディレクトリは再帰せずループ回避、`.claude` 等の dotfile は探索対象）。Renderer 側は検索クエリが非空のときに既存ツリー描画を `SearchResultsPanel` のフラットリストに切り替え、150ms デバウンス + cancelled フラグで race condition 回避。各結果行は「ファイル名 + ルートからの相対ディレクトリ」を 2 行表示し、クリック選択 / `.md` シングルクリックで Markdown エディタ起動 / 右クリックで既存コンテキストメニュー（コピー / VSCode / 名称変更 / 移動 / 削除）を提供。あわせて、検索フィールド内で `cmd+delete` `cmd+←` `cmd+→` `cmd+z` `cmd+shift+z` 等のテキスト編集ショートカットが効かない問題も修正。`App.tsx` の capture-phase keydown ハンドラがこれらを横取りして端末に送っていたため、`EDITABLE_PASSTHROUGH_IDS` を導入し editable target にフォーカスがある場合はマッチしてもブラウザ標準動作へ委譲する。

#### 変更点

- **file-system-handler.ts**: `searchTree(rootPath, query, options?)` を新規追加。`fs.promises.readdir(withFileTypes)` で再帰探索し、ファイル名の case-insensitive 部分一致で `DirEntry[]` を返す。探索順はディレクトリ優先 + ロケール順で安定化、symlink は `fs.promises.stat` で実体解決し isDirectory を正しく判定。シンボリックリンクのディレクトリは再帰しない（ループ回避）。`{ entries, truncated }` を返し、上限到達は呼び出し側で警告表示できるようにした
- **ipc-handlers.ts**: `fs:searchTree` IPC ハンドラ登録。`validatePath` でルートパスを検証してから `searchTree` を呼ぶ既存パターン踏襲。返却型は `{ ok: true, entries, truncated } | { ok: false, error }`
- **preload/index.ts**: `window.api.fs.searchTree(rootPath, query)` を公開。型シグネチャを明示し renderer 側で型補完が効くようにした
- **DirectoryTree.tsx (検索 UI)**: 検索クエリ非空のとき `SearchResultsPanel` をツリーの代わりに描画。`SearchState = idle/loading/ready/error` の discriminated union で状態管理。150ms `setTimeout` + `cancelled` フラグでデバウンス + race condition 対策（unmount や次回入力時に古い結果が state を上書きしない）。`SearchResultRow` は `{ name, relativeDir }` の 2 行表示、`isMarkdownPath` 判定で `.md` シングルクリック → `onRequestEditMarkdown`、右クリックで既存 `handleContextMenu` 経由のコンテキストメニュー（buildMenuItems で構築される 8 項目）を発火
- **App.tsx (editable passthrough)**: `EDITABLE_PASSTHROUGH_IDS: ReadonlySet<ShortcutId>` を新設し、`kill-line-backward` / `kill-line-forward` / `move-line-start` / `move-line-end` / `kill-word-backward` / `kill-word-forward` / `move-word-left` / `move-word-right` / `undo` / `redo` を含めた。`handleKeyDown` のディスパッチループで `inEditable && EDITABLE_PASSTHROUGH_IDS.has(def.id)` のとき preventDefault せずに早期 return し、ブラウザ標準のテキスト編集動作（cmd+delete で行頭まで削除、cmd+←/→ で行頭/行末移動、cmd+z で undo 等）が input 要素に届くようにした。`isEditableTarget` は xterm の helper textarea を除外する既存実装をそのまま流用（端末側のショートカット動作は不変）
- **新規テスト**: `main/__tests__/searchTree.test.ts`（9 件）— 一時ディレクトリで実ファイルツリーを構築してテスト。検証項目: ルート直下マッチ / サブディレクトリ再帰マッチ（`.claude/MEMORY.md`）/ 大文字小文字無視 / `node_modules` スキップ / 深い階層 / 空クエリ・whitespace-only クエリ / `maxResults` 超過時の `truncated=true` / `maxDepth` 制限 / `isDirectory`・`isSymlink` フラグ
- **テスト合計**: 28 ファイル / 388 件グリーン（修正前 379 から +9 件）

### 2026-04-27 - Settings カラー編集の簡略化（セマンティック 6 色化）

#### 概要

Settings → 外観のカラー編集が 33 フィールド（基本色 6 + ANSI 16 + App UI 11）に膨らんでおり、特に AppColors の `terminalBackground` と XtermTheme の `background` のように同一概念が二重定義されていることでユーザーが意図しない挙動を起こしていた。これを「セマンティック 6 色」（背景 / 前景 / アクセント / サブテキスト / ボーダー / Danger）に集約し、内部の重複フィールドを 1 つの onChange で同時に更新する形に再設計。各セマンティックの更新先は互いに排他になっており、副作用バグを構造的に防ぐ。ANSI 16 色は折りたたみアコーディオンとして残し、App UI カラーアコーディオンは撤去。

#### 変更点

- **AppearanceSettings.tsx (UI 簡略化)**: 旧 3 アコーディオン（基本色 6 / ANSI 16 / App UI 11 = 33 フィールド）を、常時表示の「カラー」セクション 6 フィールド + 折りたたみ「ANSI 16 色（上級）」アコーディオンの 2 ブロック（合計 22 フィールド）に置換
- **semanticUpdate / readSemantic ヘルパ**: `semanticUpdate(key, value): ThemeUpdate` を新規追加し、各セマンティック色から内部フィールドへのマッピングを集約
- **新規テスト**: `components/settings/__tests__/semanticColors.test.ts` 11 件（排他性の不変条件テスト含む）
- **テスト合計**: 26 ファイル / 379 件グリーン（修正前 368 から +11）

### 2026-04-27 - Markdown エディタ dark モード背景の修正

#### 概要

dark テーマ選択時、Markdown エディタの背景が白いままになる症状を修正。`@uiw/react-codemirror` がデフォルトで挿入する `defaultLightThemeOption` が我々の `editorTheme` を CSS 順序で上書きしていたのが原因。`<CodeMirror>` に `theme="none"` を明示的に渡してデフォルト Extension の挿入をスキップする形に修正。

#### 変更点

- **MarkdownEditor.tsx**: `<CodeMirror>` に `theme="none"` を明示的に渡してデフォルトの `defaultLightThemeOption` Extension の挿入をスキップ

### 2026-04-27 - サイドバーのファイル名アイコンずれ修正 + 検索フィールド追加

#### 概要

ディレクトリツリーで長いファイル名のとき、サイドバーを最小幅にスライドするとファイル/フォルダアイコンが微妙に左へずれる現象を修正。原因は `TreeNode.tsx` の chevron / icon span が `display: inline-flex` + 固定 `width` のみで `flex-shrink: 0` を持たず、親 flex コンテナの幅不足時に flex 子要素として自動圧縮されていたこと。あわせて、サイドバー上部のルートディレクトリ名行を撤去し `<input type="search">` を設置。`sidebarStore` に `searchQuery` を追加し、トップレベルと子階層の双方で `name` の case-insensitive 部分一致フィルタを適用。

#### 変更点

- **TreeNode.tsx (アイコン圧縮バグ修正)**: chevron 用 `<span>` と folder/file アイコン用 `<span>` の両方に `flexShrink: 0` を追加
- **TreeNode.tsx (検索フィルタ + 子階層対応)**: `ChildList` に `useSidebarStore((s) => s.searchQuery)` 購読を追加、`filterEntriesByQuery(entries, query)` を named export として切り出し
- **DirectoryTree.tsx (ルート行 → 検索フィールド置換)**: 旧ルート表示を削除し `<input type="search">` を設置
- **sidebarStore.ts (state 拡張)**: `searchQuery: string` フィールドと `setSearchQuery(query)` action を追加
- **新規テスト**: `Sidebar/__tests__/filterEntriesByQuery.test.ts`（7 件）+ `sidebarStore.test.ts` の 3 アサーション追加
- **テスト合計**: 25 ファイル / 368 件グリーン（修正前 361 から +7 件）

> 2026-04-29 ローリングアーカイブ: 2026-04-26 の 2 エントリ（Markdown エディタテーマ対応 / Settings モーダル新設）を [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。

> 2026-04-27 ローリングアーカイブ: これ以前の 30 エントリは [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。
