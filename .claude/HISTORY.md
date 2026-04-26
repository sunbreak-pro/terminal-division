# HISTORY.md - 変更履歴

### 2026-04-26 - Settings UI（テーマ / ショートカット / 不透明度、T2-9）（計画書: archive/2026-04-26-settings-feature.md）

#### 概要

Settings モーダル（800×600、左カテゴリ + 右タブ）を新設し、xterm.js `ITheme` 全 30 プロパティのカスタマイズ、ショートカット 24 ID の record-key 再割当（競合検出付き）、ウィンドウ不透明度スライダー + vibrancy トグルを 1 画面に統合。設計は VS Code / Zed 方式の「GUI first + JSON SSOT」で、`userData/settings.json` を Single Source of Truth にし、Renderer は `useSettingsStore` (Zustand) 経由で main からブロードキャストされる `settings:changed` を購読。テーマ編集は **「ライブプレビュー + 明示的保存」** モデルを採用：`themeStore.overrideTheme` に draft を保持して後ろのターミナル本体（xterm.js）にもリアルタイム反映、フッターの「保存」ボタンで `updateCustomTheme()` を呼び settings に永続化、「キャンセル」/× / ESC / 背景クリックで draft 破棄。`react-colorful` の HexColorPicker をポップオーバー化した `ColorField` 共通コンポーネントが、内部に draft state を持って **「タイプ中の不完全な HEX を親に流さない」** ことでテーマが消える致命バグを構造的に防ぐ。`.itermcolors`（XML plist）パーサを外部依存ゼロで実装し、`mbadolato/iTerm2-Color-Schemes` の 450+ プリセットをインポート可能。Header の旧「ショートカット」ボタンは Settings 内のショートカットタブで完全代替されたため削除。

#### 変更点

- **shared SSOT 化**: `src/shared/theme-types.ts` に `XtermTheme` / `AppColors` / `Theme` 型と `validateTheme` / `isHexColor` を集約（renderer/styles/theme.ts は型を re-export + プリセット値のみ保持）。`src/shared/settings.ts` に `AppSettings` / `validateAppSettings` / `mergeSettings` を SSOT 化、検証はフィールド単位フォールバック（セッション永続化と異なり一部破損で全設定を失わない）
- **main 永続化**: `src/main/settings.ts` に `SettingsManager`（`userData/settings.json`、debounce 250ms、broadcast 即時、サイレントフォールバック）。`src/main/itermcolors-parser.ts` で plist XML を正規表現パース（外部依存なし、1MB 上限、Ansi 0-15 + Background/Foreground/Cursor/Selection マッピング）
- **IPC 5 チャネル追加**: `settings:get` / `settings:update` / `settings:importItermColors` (handle/invoke)、`settings:changed` (broadcast)、`window:setOpacity` / `app:relaunch` (on/send)。`window-manager.ts` で起動時に `settingsManager.get().window` を反映し、`vibrancyEnabled` のとき `transparent: true` + `vibrancy: "under-window"` + `backgroundColor: "#00000000"` の 3 点セットを適用、`win.setOpacity(opacity)` で初期値反映
- **shortcuts レジストリ化**: `src/renderer/shortcuts/registry.ts` に 24 ID（split-vertical / focus-_ / kill-line-_ / open-settings 等）を SSOT 化。`parseKey` / `matchKey` / `formatKey` / `canonicalize`（cmd/meta/command エイリアス吸収）/ `resolveShortcutKey`（user override > default）/ `findConflictingIds` を提供。App.tsx の 23 個の `if` ブロックを `Partial<Record<ShortcutId, handler>>` ディスパッチに置換、Cmd+Shift+Arrow → select-current-line のエイリアス 4 キーのみ前段で特殊処理
- **settingsStore + settingsModalStore**: `useSettingsStore`（load / update / `settings:changed` 購読 / 楽観更新）+ セレクタ `useShortcutBindings` / `useWindowSettings` / `useCustomThemes`。`useSettingsModalStore` で isOpen + recordingShortcutId を管理し、録音中は App.tsx 側で global keydown を抑制、ShortcutSettings 側の listener が capture phase で取得
- **themeStore リファクタ**: `availableThemes`/`getCurrentTheme` を撤去 → `useAvailableThemes` / `useCurrentTheme` をリアクティブフック化。`overrideTheme` フィールドと `setOverrideTheme()` 追加、`useCurrentTheme` の優先順位は **override > 組込 > customThemes > default**。`setTheme()` は永続化付き（settings.update を呼ぶ）+ override クリア。`setThemeIdLocal()` は永続化なし（起動時 settings load 反映用）。`addCustomTheme` / `updateCustomTheme` / `deleteCustomTheme` を追加（settings 経由で全ウィンドウへ broadcast）
- **SettingsModal + 4 サブコンポーネント**: `SettingsModal.tsx`（800×600、左 180px カテゴリリスト + 右タブ、フッターに「キャンセル」「保存」、未保存変更インジケータ）、`AppearanceSettings.tsx`（テーマ選択 / 「複製して編集」 / カスタム編集 / 基本色・ANSI 16 色・App UI のアコーディオン / ライブプレビュー / .itermcolors インポート / JSON エクスポート、auto-editing useEffect でカスタム選択時に override 自動セット）、`ShortcutSettings.tsx`（24 ID 表 / Record-Key UX / 競合検出バナーで上書き or キャンセル / クリア / デフォルトに戻す）、`WindowSettings.tsx`（Opacity スライダー即時反映 / Vibrancy トグル + 再起動誘導）、`ColorField.tsx`（react-colorful + HEX 入力 + スウォッチ + click-outside、内部 draft state で **不完全 HEX を親に流さない**）
- **ColorField 致命バグ修正**: 旧実装は HEX 入力欄の onChange で常に親に通知していたため、ユーザーが `#ff` までタイプした瞬間に main 側 validateTheme が null を返し customThemes 配列からテーマが落ちて「色変更がリセットされる」現象が発生。draft state で「有効 HEX のみ親に通知」+ blur 時に draft を value にスナップ復帰する形に修正
- **保存モデル変更**: 旧実装は ColorField onChange → 即 settings 永続化だったが、ユーザー要望「閉じたら変更が消える / 明示的に保存したい」に対応するため draft / commit モデルへ。テーマ編集中の override は `themeStore` に保持してターミナル本体にライブ反映、「保存」ボタンで `updateCustomTheme(draft)` 永続化 → override クリア。「キャンセル」/× / ESC / 背景クリック / テーマ切替で override 自動クリア。Opacity / Vibrancy / ショートカットは即時保存のため Save の対象外（フッターヘルプテキストで明示）
- **Header 整理**: 「ショートカット」ボタンを削除（Settings 内のショートカットタブで完全代替）、代わりに歯車アイコンの「設定 (Cmd+,)」ボタンを追加。`ShortcutsModal.tsx` とそのテストを撤去
- **window-manager**: 起動時に settings 読込 + `vibrancyEnabled` 反映 + `setOpacity()` 初期値適用
- **registry のバグ修正（テスト駆動）**: `normalizeKeyName(" ")` が length-1 ブランチで先 return して `"Cmd+ "` を返していたバグを Gate 4 で検出し修正（→ `"Cmd+Space"`）
- **新規テスト 53 件**: `shortcuts/__tests__/registry.test.ts`（24 ケース、parseKey の修飾キー順序 / 修飾キー単独 null / Space 正規化、matchKey の case-insensitive とエイリアス、formatKey の絵文字レンダリング、resolveShortcutKey / findConflictingIds の override・null・除外）、`shared/__tests__/theme-types.test.ts`（10 ケース、isHexColor の各種パターンと validateTheme のフィールド単位検証）、`shared/__tests__/settings.test.ts`（19 ケース、validateAppSettings の version / opacity clamp / vibrancy 厳密 true / shortcut 文字列長制限 / customThemes フィルタ、mergeSettings の浅マージ・shortcuts 完全置換）
- **既存テスト更新**: `themeStore.test.ts` を新 API に追従（getCurrentTheme メソッド撤去 → setTheme/setThemeIdLocal/themes record 直接ルックアップ）、`Header.test.tsx` の「ショートカットモーダル」テストを「設定ボタン → settingsModalStore.open()」に置換、`ShortcutsModal.test.tsx` を撤去
- **テスト合計**: 24 ファイル / 335 件グリーン（修正前 282 から +53 件）
- **依存追加**: `react-colorful`（軽量 ~2.8kB、HexColorPicker のみ使用）
- **設計判断**:
  - **GUI first + JSON SSOT**: VS Code / Zed の二層モデル。settings.json を SSOT にすることでパワーユーザーが直接編集でき、GUI は発見可能性を担保。Zed 公式ブログ「JSON only では新機能の発見が impossible」の知見を採用
  - **ウィンドウ独立 + 永続化共通**: `themeStore.currentThemeId` はウィンドウローカル（settings broadcast でも他ウィンドウのテーマは触らない）。`customThemes` / `shortcuts` / `window` は全ウィンドウ即時同期。前提は既存 `make each window's theme independent` コミット (a155d11) の方針踏襲
  - **draft / commit モデル（テーマ編集のみ）**: 「色変更が消える」問題と「明示的保存が欲しい」要望の両方を解決。Opacity / Vibrancy / ショートカットを draft 化しなかったのは UX 的に「即時反映」が自然なため（特に Opacity スライダー）。フッターヘルプテキストで両者の振る舞いを明示
  - **ColorField の draft state**: タイプ中の不完全な HEX を親に流すと、main 側 validateTheme が「全フィールド有効」を要求するためテーマ全体を破棄してしまう。renderer 側で「有効値のみ親に通知」が最もロバスト
  - **vibrancy デフォルト Off**: Electron #31862（vibrancy + transparent で白背景、v16+ の既知バグ）を考慮しオプトイン方式。フッターヘルプテキストで「再起動が必要」「一部環境で背景が白くなる」を明示。CSS `backdrop-filter` フォールバックは Phase 2 候補
  - **Cmd+Shift+Arrow エイリアス**: 1 アクション × 4 キー（select-current-line）の特殊ケースは registry に乗せず前段で直接処理。registry の「1 ID = 1 デフォルトキー」ルールを保つ
  - **`.itermcolors` パーサの外部依存ゼロ**: `plist` パッケージを使わず正規表現で実装。`mbadolato/iTerm2-Color-Schemes` の 450+ プリセットを取り込めればユーザー価値が大きく、依存追加は不釣り合い。AppColors は base テーマから流用、xterm パートのみ上書き
  - **registry の Space バグ**: テスト駆動で発見。length-1 ブランチで先 return する設計を「" " を先に special-case」に変更。同種のバグはテストの存在意義そのもの
- **計画書アーカイブ**: `.claude/archive/2026-04-26-settings-feature.md` に Status=COMPLETED で移動済み

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

> 2026-04-26 ローリングアーカイブ: これ以前の 26 エントリは [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。
