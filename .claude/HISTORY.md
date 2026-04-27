# HISTORY.md - 変更履歴

### 2026-04-27 - Settings カラー編集の簡略化（セマンティック 6 色化）

#### 概要

Settings → 外観のカラー編集が 33 フィールド（基本色 6 + ANSI 16 + App UI 11）に膨らんでおり、特に AppColors の `terminalBackground` と XtermTheme の `background` のように同一概念が二重定義されていることでユーザーが意図しない挙動（「ターミナル背景を白から黒に動かしてもある境目までは見た目が変わらず、`isLightBackground` の輝度 0.5 を跨いだ瞬間に MarkdownEditor 側のオフホワイト切替が一気にスナップする」）を起こしていた。これを「セマンティック 6 色」（背景 / 前景 / アクセント / サブテキスト / ボーダー / Danger）に集約し、内部の重複フィールドを 1 つの onChange で同時に更新する形に再設計。各セマンティックの更新先は互いに排他（同じフィールドが 2 つのセマンティックから書かれない）になっており、副作用バグを構造的に防ぐ。ANSI 16 色は折りたたみアコーディオンとして残し、細かい xterm 色は `.itermcolors` インポート前提とする運用に寄せた。App UI カラーアコーディオンは撤去（重複フィールドはセマンティック側に吸収済み）。

#### 変更点

- **AppearanceSettings.tsx (UI 簡略化)**: 旧 3 アコーディオン（基本色 6 / ANSI 16 / App UI 11 = 33 フィールド）を、常時表示の「カラー」セクション 6 フィールド + 折りたたみ「ANSI 16 色（上級）」アコーディオンの 2 ブロック（合計 22 フィールド）に置換。`SEMANTIC_DEFS` テーブル（key / label / description）でセマンティック色の表示を駆動
- **AppearanceSettings.tsx (semanticUpdate ヘルパ)**: `semanticUpdate(key, value): ThemeUpdate` を新規追加し、各セマンティック色から内部フィールドへのマッピングを集約。`background` → `xterm.background` + `colors.background` + `colors.headerBackground` + `colors.terminalBackground` + `xterm.cursorAccent` + `xterm.selectionForeground`（6 フィールド一括）。`accent` → `colors.accent` + `colors.activeTerminal` + `colors.borderActive` + `xterm.cursor` + `xterm.selectionBackground`（5 フィールド一括）。`foreground` / `textSecondary` / `border` / `danger` も同様にマッピング。各セマンティックの更新先フィールド集合は互いに排他
- **AppearanceSettings.tsx (readSemantic ヘルパ)**: 表示時はセマンティック値の代表フィールドを 1 つだけ読む（例: `background` は `xterm.background` を読む。これにより xterm 本体の現在背景がそのまま picker に表示される）。`colors.terminalBackground` を読まないことで「片方のフィールドだけ動いて UI が同期しない」混乱を回避
- **AppearanceSettings.tsx (handleSemanticColor)**: `setOverride({ ...overrideTheme, colors: { ...overrideTheme.colors, ...update.colors }, xterm: { ...overrideTheme.xterm, ...update.xterm } })` で colors / xterm 双方をシャロー spread + マージ。これにより重複なしの一括更新が成立
- **MarkdownEditor.tsx (dark モード背景の干渉除去 — 別 commit に分離可)**: `<CodeMirror>` に `theme="none"` を明示的に渡し、`@uiw/react-codemirror` がデフォルトで挿入する `defaultLightThemeOption` (`{ '&': { backgroundColor: '#fff' } }`) の追加をスキップ。我々の `editorTheme` extension が同じ `&` セレクタの `backgroundColor` を設定するが、defaultLightThemeOption が後続適用される CSS 順序で上書きされていた。これにより HighlightStyle (`accent` 色 / `codeFg` `#e6a26a`) は dark テーマの色で適用されつつ背景だけ白いという不整合が dark モードで発生していたのを解消
- **新規 export 化**: `semanticUpdate` / `readSemantic` / `SemanticKey` を named export にしてテスト容易にした
- **新規テスト**: `components/settings/__tests__/semanticColors.test.ts` 11 件（`readSemantic` の 4 ケース、`semanticUpdate` の 6 ケース、加えて「全セマンティック間でフィールドが排他」を保証する不変条件テスト 1 件）。テスト合計 26 ファイル / 379 件グリーン（修正前 368 から +11）
- **設計判断**:
  - **セマンティック更新は排他マッピングを採用**: ナイーブな実装だと「色 A を変えたら全派生色を上書き」になりがちだが、それだと既存のチューニング値が消える。各セマンティックが「自分の責任フィールドだけ」更新する排他マッピングにすれば、ユーザーが意図的に他セマンティックを動かすまで他フィールドは保持される。テストで排他性を不変条件として担保
  - **`background` は xterm + AppColors を同時更新**: バグの本丸。旧 UI では `colors.terminalBackground` 編集 → xterm 不変 → MarkdownEditor の `isLightBackground` 判定だけが luminance 0.5 で flip → 「境目で一気に変色」が起きていた。両方を同時更新すれば xterm 本体が滑らかに変色し、MarkdownEditor の閾値挙動はそのまま意図通り（light/dark の境界で off-white に切替わる）に戻る
  - **代表フィールド読出方式**: 6 セマンティックの「現在値」をどう表示するかは `xterm.background` か `colors.terminalBackground` か競合する。xterm 本体が描画している色 = `xterm.background` を真とすることで、ユーザーが「いま見えている色」と picker の値が一致する
  - **App UI アコーディオンを完全撤去**: 「app/xterm の重複問題」の根源だった。残せば結局二重編集が可能になり、6 色化のメリットが消える。細かい AppColors（buttonHover 等）はセマンティックで吸収。組込テーマや `.itermcolors` インポート時の値は保持される（編集 UI から触れないだけ）
  - **ANSI 16 色は残す**: ターミナル `ls` 等の出力色は xterm の独自テーマ領域で、セマンティック 6 色とは別軸。ただし `.itermcolors` インポート（450+ プリセット）でまとめて変更するのが現実的なので、折りたたみ default で「上級」と明示して目立たないようにした

### 2026-04-27 - Markdown エディタ dark モード背景の修正

#### 概要

dark テーマ選択時、Markdown エディタの背景が白いまま（テキスト色は dark モード用の青系やインラインコードのオレンジ `#e6a26a` は反映されているのに背景だけ白）になる症状を修正。`@uiw/react-codemirror` の `theme` prop はデフォルトが `"light"` で、内部的に `defaultLightThemeOption` (`EditorView.theme({ '&': { backgroundColor: '#fff' } }, { dark: false })`) を最後尾に挿入する。我々の `editorTheme` extension は同じ `&` セレクタに `backgroundColor: editorChrome.editorBg` を指定していたが、CodeMirror の StyleModule 適用順序で defaultLightThemeOption が後勝ちし背景だけが白に固定されていた。`{ dark: false }` フラグはハイライトテーマの暗色判定にしか使われないため、HighlightStyle の color 群（`theme.colors.accent` / `codeFg` 等）は dark モード用の色がそのまま生きており、結果として「色は dark、背景は white」のチグハグ表示が発生していた。

#### 変更点

- **MarkdownEditor.tsx**: `<CodeMirror>` に `theme="none"` を明示的に渡してデフォルトの `defaultLightThemeOption` Extension の挿入をスキップ。これにより我々の `editorTheme` の `&: { backgroundColor: editorChrome.editorBg }` (dark テーマなら `#0d0d0d` / light テーマなら `#fbfbf9`) が唯一の `&` 背景指定として有効になる
- **設計判断**:
  - **`theme="none"` の選択**: 代替案として `theme={editorTheme}` を渡すこともできたが、現状 `editorTheme` は extensions 配列にも入っており重複登録になる。`"none"` で defaultLightThemeOption だけスキップさせ、extensions 経由で渡す既存配線を維持するほうが副作用が少ない
  - **light テーマの off-white `#fbfbf9` は残置**: 旧セッションで「pure white は長時間編集で疲れる」目的で導入された値で、dark モード背景バグとは別軸。今回のバグ修正で挙動は意図通り（dark なら terminalBackground / light なら off-white）に戻る

### 2026-04-27 - サイドバーのファイル名アイコンずれ修正 + 検索フィールド追加

#### 概要

ディレクトリツリーで長いファイル名のとき、サイドバーを最小幅にスライドするとファイル/フォルダアイコンが微妙に左へずれる現象を修正。原因は `TreeNode.tsx` の chevron / icon span が `display: inline-flex` + 固定 `width` のみで `flex-shrink: 0` を持たず、親 flex コンテナの幅不足時に flex 子要素として自動圧縮されていたこと。あわせて、サイドバー上部の「タブ下＋ツリー上」に表示していたルートディレクトリ名（`terminal-division · ~/dev/...`）行を撤去し、代わりに `<input type="search">` を設置。`sidebarStore` に `searchQuery` を追加し、トップレベル（`DirectoryTree`）と子階層（`ChildList`）の双方で `name` の case-insensitive 部分一致フィルタを適用する。検索フィールド行は `minHeight: 36` でルート行（11px・xs パディング）より縦に余裕を持たせ、フォーカス時に `borderColor` を `borderActive` にハイライトする UX を採用。

#### 変更点

- **TreeNode.tsx (アイコン圧縮バグ修正)**: chevron 用 `<span>`（`width: 12`）と folder/file アイコン用 `<span>`（`width: 14`）の両方に `flexShrink: 0` を追加。親 `<div role="treeitem">` が `display: flex` + `overflow: hidden` で、長いファイル名のとき flex 子要素として圧縮されアイコン位置が左にずれていたのを根絶
- **TreeNode.tsx (検索フィルタ + 子階層対応)**: `ChildList` に `useSidebarStore((s) => s.searchQuery)` 購読を追加し、`dirState.entries` を新規ヘルパ `filterEntriesByQuery` で絞り込み。フィルタ結果が空の場合は「一致なし」（イタリック）を表示し、本来の「（空）」と区別。`filterEntriesByQuery(entries, query)` を named export として切り出し（純粋関数: 空 / whitespace-only クエリは元配列を即返、それ以外は trim → toLowerCase → `name.includes` でフィルタ）
- **DirectoryTree.tsx (ルート行 → 検索フィールド置換)**: 旧ルート表示（`{basenameOf(rootPath)} · {displayPath}`、padding xs/sm、fontSize 11、textSecondary）を削除し、`<input type="search">` を設置。コンテナは padding `sm/sm`、`minHeight: 36`、`display: flex`、`gap: 6`、`borderBottom`。input は `flex: 1` + `minWidth: 0`（flex overflow 対策）、padding `5px/8px`、border 1px、`borderRadius: 4`、placeholder「ファイル名で検索」、`spellCheck={false}`、aria-label 付き。`onFocus` / `onBlur` で `borderColor` を `borderActive` ⇄ `border` に切替（style.border 同値再レンダ時は React style diff で DOM 操作されないため focus 表示は保持）
- **DirectoryTree.tsx (トップレベルフィルタ + 状態別メッセージ)**: `useMemo` で `visibleEntries = dirState.status === "ready" ? filterEntriesByQuery(dirState.entries, searchQuery) : []` を導出。レンダリングを `dirState.entries` から `visibleEntries` に切替。状態別メッセージは 3 分岐: (a) `entries.length === 0` → 「（空のディレクトリ）」、(b) `entries > 0 && visible === 0` → 「一致するファイルがありません」、(c) `visible > 0` → エントリ列挙。検索クエリと真の空ディレクトリを UI 上で区別
- **sidebarStore.ts (state 拡張)**: `searchQuery: string` フィールドと `setSearchQuery(query)` action を `SidebarStore` interface に追加。初期値 `""`、setter は同値スキップ（`get().searchQuery === query` で early return）して再レンダ抑制。永続化対象には含めない（タブ切替やセッション間で持ち越さない方針、明示的にユーザーがクリアできる UX に委ねる）
- **新規テスト**: `Sidebar/__tests__/filterEntriesByQuery.test.ts`（7 件、空 / whitespace-only クエリで元配列を返す参照同一性 / case-insensitive substring / mixed case / 空マッチ / trim / files+dirs を区別なく match）。`stores/__tests__/sidebarStore.test.ts` に `setSearchQuery` の更新 / 同値時の state 参照同一性 / 空文字復帰の 3 アサーション追加。`beforeEach` の reset state にも `searchQuery: ""` を追加
- **テスト合計**: 25 ファイル / 368 件グリーン（修正前 361 から +7 件）
- **設計判断**:
  - **flex 子要素の圧縮防止は `flexShrink: 0` が正解**: アイコン span は意味的に「固定サイズの装飾」であり flex 計算で縮められたくない。`min-width` の代わりに `flex-shrink: 0` を使う方が、ベース幅 (`width: 12/14`) と圧縮ポリシーが分離されて意図が明確
  - **フィルタは全階層に適用**: 「root だけフィルタ」案も検討したが、サブフォルダを展開した瞬間に検索クエリが効かなくなるのは予測不能で混乱を招く。「クエリが空でない間はどの階層でも `name` で絞る」という単純で予測可能なルールを優先。トレードオフとして `.claude` がマッチして展開しても中身は `name` でさらに絞られるが、ユーザーがクリアすれば全ツリーが戻る前提で許容
  - **検索クエリを sidebarStore に置く**: `DirectoryTree` と `TreeNode/ChildList` の両方が同じクエリに反応する必要があるため context や props drilling より store が自然。selectedTabCwd 切替時のクリアは現時点で実装せず、ユーザーが明示的に消す挙動（input value 表示があるので状態は可視）に委ねる
  - **`filterEntriesByQuery` を export**: 純粋関数で再利用性とテスタビリティが高い。`TreeNode.tsx` 内で完結させてもよかったが、`DirectoryTree.tsx` のトップレベルフィルタからも参照するため一箇所に集約。テストも書きやすい
  - **input border のフォーカス UX**: state を増やさず DOM mutation で完結。React の style diff は同値プロパティを再適用しないため、`searchQuery` 変化のたびの再レンダでもフォーカス枠は保持される（`border` shorthand を使っているが、文字列が同一なので React は触らない）
  - **空ディレクトリ vs 検索ヒット 0 の区別**: 同じ「（空）」表示だと「ディレクトリが空なのか」「検索でフィルタされたのか」が判別不能。ユーザーが検索中だと自明なケースでも、UI 側で明示するほうが説明コストが低い

### 2026-04-26 - Markdown エディタのテーマ対応 UI/UX リデザイン

#### 概要

T2-8 で導入したペイン内 Markdown エディタが light テーマで「真っ白で見づらい」問題に対し、CodeMirror 設定をテーマ駆動に作り直した。原因は `EditorView.theme(..., { dark: true })` がハードコードされており（light テーマでも CodeMirror が dark モードとして動作）、かつ markdown 構文用の `HighlightStyle` が未定義で見出し / リンク / コード等が pale な default 色のままだったこと。修正は (a) 背景色の輝度から light/dark を自動判定して `dark` フラグを切替、(b) 見出し / 強調 / リンク / リストマーク / 引用 / 区切り線 / コード等を `theme.colors.accent` / `text` / `textSecondary` / `border` から派生させた `HighlightStyle` を新設、(c) 不透明だった選択背景を `withAlpha(accent, 0.28)` のセミトランスペアレントに、active line も `accent` 6–9% alpha に置換、(d) light テーマの editor 部分のみ `#fbfbf9` のオフホワイトに（xterm 側の light 設定には触れない）、(e) ファイルパスバーを `[MD]` バッジ + ディレクトリ淡色 + ファイル名強調に再設計。色操作ヘルパは `colorUtils.ts` に切り出して 25 件の単体テストを追加。

#### 変更点

- **MarkdownEditor.tsx**: `EditorView.theme()` の `{ dark: true }` ハードコードを `{ dark: !isLightBackground(theme.colors.terminalBackground) }` に変更（カスタムテーマも輝度判定で自動分岐）。`editorChrome` を `useMemo` で派生させ editorBg / gutterBg / codeBg / codeFg / ruleColor を一元管理。`.cm-selectionBackground` を `borderActive` ベタ塗り → `withAlpha(accent, 0.28)` に、`.cm-activeLine` / `.cm-activeLineGutter` を `buttonHover` → `withAlpha(accent, 0.06–0.16)` に置換。`.cm-content` に padding 14/6/32/6、`.cm-scroller` に lineHeight 1.65、フォントサイズ 13→13.5px、cursor 線幅 2px、`.cm-gutters` に `borderRight: 1px solid border` を追加。light テーマ時は editor 背景を pure white から `#fbfbf9` のオフホワイトに置換
- **HighlightStyle 新設**: `@codemirror/language` の `syntaxHighlighting` + `HighlightStyle.define` で markdown 用構文ハイライトを定義。heading1–6 / strong / emphasis / strikethrough / link / url / monospace / quote / processingInstruction (= ListMark / HeaderMark) / contentSeparator / meta を `theme.colors.accent` / `text` / `textSecondary` / `border` および inline code 専用色（light=`#a3274a`、dark=`#e6a26a`）から派生
- **ファイルパスバー再設計**: 単純な path 表示から `[MD]` バッジ（accent 12% alpha 背景 + 55% alpha ボーダー）+ ディレクトリ淡色 70% opacity + ファイル名 fontWeight 600 + `direction: rtl` で省略時もファイル名が見える形に変更
- **新規 utility**: `src/renderer/utils/colorUtils.ts` に `withAlpha(hex, 0..1)` と `isLightBackground(hex)` を切り出し（`#rrggbb` 専用、不正形式・非対応形式は素通し / false 返し）。MarkdownEditor 内のインライン定義から外出しして再利用可能化
- **新規テスト**: `utils/__tests__/colorUtils.test.ts` (25 件) — withAlpha は alpha 0/0.5/1 / クランプ（>1, <0）/ # 正規化 / 短縮形と長すぎる hex の素通し / 単一バイト保証、isLightBackground は white/black/各テーマ背景 / 加重輝度（pure red=dark, pure green=light, pure blue=dark）/ 0.5 閾値（#808080=light, #777777=dark）/ shorthand 非対応 / 不正 hex / # 省略許容
- **テスト合計**: 25 ファイル / 361 件グリーン（修正前 336 から +25 件）
- **依存追加**: なし（`@codemirror/language` / `@lezer/highlight` は既に `@uiw/react-codemirror` 経由で transitively 解決済み）
- **設計判断**:
  - **dark フラグ判定を `theme.id` ではなく輝度ベース**: カスタムテーマ（Settings UI で追加可能）を考慮すると id ベース判定はカバーしきれない。`terminalBackground` の加重輝度 (0.299R + 0.587G + 0.114B) > 0.5 で light 判定するほうがロバスト
  - **light テーマだけ editor 背景を `#fbfbf9` に**: pure white は長時間編集で疲れるが、テーマ全体（xterm 含む）の `terminalBackground` を変えると影響が大きい。MarkdownEditor 内だけ off-white にすることで「ターミナルは白、エディタは少し落とした白」の差を作りつつ既存テーマ定義は無傷
  - **選択 / アクティブ行に alpha**: 旧実装は `borderActive` 不透明で選択文字が読めない致命的な UX 問題があった。アプリ全体の `withAlpha` ヘルパーは将来別コンポーネントでも再利用するため utils に切り出し
  - **HighlightStyle を別 useMemo に**: editorTheme と分離することで「chrome（gutter / cursor / 選択）」と「コンテンツ構文（見出し / リンク / コード）」の責務を明確化。両方とも `[theme.colors, editorChrome]` 依存だが、将来コードブロック言語別ハイライトを足す際の差分が局所化される
  - **ファイルパスの `direction: rtl`**: 長い絶対パスでも常に末尾（ファイル名）が見える。Bidi 反転のためテキスト本体を `unicodeBidi: plaintext` に包んで論理順序を保つ標準テクニック

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


> 2026-04-27 ローリングアーカイブ: これ以前の 29 エントリは [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。
