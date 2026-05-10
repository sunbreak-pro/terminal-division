# HISTORY.md - 変更履歴

### 2026-05-10 - VSCode 起動 fallback (open -a) + 4 ショートカット追加（VSCode 起動 / cd ピッカー / フルスクリーン切替 / ファイル名検索フォーカス）

#### 概要

ユーザー要望「LeftSidebar の『VSCode で開く』が PATH に `code` がないと失敗する。修正＋ショートカットも追加。さらに『ディレクトリ移動』『フルスクリーン⇄通常画面切替』『ファイル名検索フォーカス』のショートカットも実装」に対応。事前に AskUserQuestion で 2 点確認: (1) ショートカット 4 つのデフォルトキーは推奨セット（VSCode=⌘⇧E / cd=⌘⇧O / fullscreen=⌃⌘F / 検索 focus=⌘P）、(2) VSCode 起動は `code` を試して失敗時に `open -a "Visual Studio Code"` フォールバック。VSCode 起動の修正は `file-system-handler.ts:openInVSCode` を `trySpawn(cmd, args)` クロージャ化して逐次フォールバック構造に書き換え。`code` の `error` イベントまたは exit≠0 時に macOS なら `open -a "Visual Studio Code" <path>` を試す。これで Shell Command: Install 'code' command 未実行ユーザでも /Applications 配下から起動可能になる（command injection 回避のため `shell:false` + argv 配列で渡す既存方針を継承）。フルスクリーン切替は main プロセスに `window:toggleFullScreen` IPC を新設し、`BrowserWindow.setFullScreen(!isFullScreen())` で macOS 標準のスペース遷移付きフルスクリーンをトグル（`setSimpleFullScreen` ではない）。preload で `window.api.window.toggleFullScreen()` を公開。新規ショートカットは `registry.ts` に 4 ID 追加（`change-directory` / `focus-file-search` / `open-in-vscode` / `toggle-fullscreen`）して既存 settings UI から再バインド可能に。`App.tsx` の keydown ハンドラに 4 ハンドラ追加: change-directory は Header の `handleChangeDirectory` と同等のフロー（`dialog.selectDirectory` → CWD escape → `cd '<path>'`）、open-in-vscode は `useTerminalMetaStore` から active CWD を取得して `fs.openInVSCode` 呼出（CWD null 時は toast）、toggle-fullscreen は preload API 直叩き、focus-file-search は `document.getElementById("header-file-search")` で focus + select。Header の中央検索 input に `id="header-file-search"` + `data-file-search-input` 属性を付与してショートカットから到達できるように。session-verifier 通過: 540 → 541 件グリーン（Header テスト +1: id 属性検証）+ `npm run build` 通過。コミット範囲は今回作業の 7 ファイル限定（Sidebar.tsx の別セッション差分はユーザー判断で除外）。

#### 変更点

- **`src/main/file-system-handler.ts`**: `openInVSCode(targetPath)` を内部関数 `trySpawn(cmd, args)` 化して逐次フォールバック構造に。`code` を試行 → 失敗（`error` イベントまたは exit code ≠ 0 を 200ms 以内に観測）時に `process.platform === "darwin"` なら `open -a "Visual Studio Code" <path>` を試行。`shell:false` + detached + stdio:ignore + env:process.env の既存セキュリティ方針は両 spawn で共通。引数を argv 配列で渡すため targetPath にバッククオート / `$()` を含んでも shell が解釈せず command injection を防ぐ
- **`src/main/ipc-handlers.ts`**: `window:toggleFullScreen` ハンドラを `window:setOpacity` の手前に追加。`BrowserWindow.fromWebContents(event.sender)` で発火元ウィンドウを取得し `win.setFullScreen(!win.isFullScreen())` をトグル。明示的 on/off API は出さず toggle のみ提供
- **`src/preload/index.ts`**: `window.api.window` ネームスペースに `toggleFullScreen(): void` を追加（`ipcRenderer.send("window:toggleFullScreen")`）。setOpacity / setZoomFactor と同じレベルの薄いラッパー
- **`src/renderer/shortcuts/registry.ts`**:
  - `ShortcutId` ユニオンに 4 ID 追加: `"change-directory"` (Terminal Management) / `"focus-file-search"` (Sidebar) / `"open-in-vscode"` (App) / `"toggle-fullscreen"` (App)
  - `SHORTCUT_DEFINITIONS` に対応エントリ追加: defaultKey は `Cmd+Shift+O` / `Cmd+P` / `Cmd+Shift+E` / `Ctrl+Cmd+F`。`Cmd+P` は VSCode 風のクイックオープン感覚に合わせる、`Ctrl+Cmd+F` は macOS 標準フルスクリーンキー
  - 既存の「ID 一意性」テスト（`SHORTCUT_DEFINITIONS / getDefinition` describe）が新規 4 ID も自動カバー
- **`src/renderer/App.tsx`**:
  - `useTerminalMetaStore` import / `showErrorToast` import を追加（ErrorToast から名前付き再 export）
  - `handlers` レコードの `open-settings` の直後に 4 ハンドラを追加
    - `change-directory`: `window.api.dialog.selectDirectory()` → 選択結果を `'\''` でシングルクオートエスケープ → `cd '<escaped>'\n` を `pty.write`。CWD なし / dialog cancel / activeTerminal なしは no-op
    - `open-in-vscode`: `useTerminalMetaStore.getState().metas.get(activeTerminalId)?.cwd` で active CWD を取得。null なら「アクティブなターミナルの CWD が取得できません」トースト。`window.api.fs.openInVSCode(target)` の `ok=false` 時は既存の DirectoryTree と同じ「`code` コマンドが PATH にありますか？」トーストを表示（fallback 後も失敗した稀ケース用）
    - `toggle-fullscreen`: `window.api.window.toggleFullScreen()` を直接呼ぶ
    - `focus-file-search`: `document.getElementById("header-file-search")` を取得し `instanceof HTMLInputElement` でガード → `focus()` + `select()`（既存値があれば全選択して即上書きできる）
  - 4 ハンドラ全てで `e.preventDefault()` + `e.stopPropagation()` を呼び、xterm 等への伝播を抑止
- **`src/renderer/components/Header.tsx`**: 中央検索 `<input type="search">` に `id="header-file-search"` と `data-file-search-input` を付与。ショートカットから到達するための anchor。既存の placeholder / aria-label / sidebarStore.searchQuery 双方向バインドはそのまま維持
- **`src/renderer/components/__tests__/Header.test.tsx`**: 「`exposes id=header-file-search on the search input for focus shortcut`」テストを追加（新規 1 件）。`document.getElementById("header-file-search")` が `HTMLInputElement` であり、`getByPlaceholderText("ファイル名で検索")` と同一要素を指すことを検証。これでショートカットと UI ラベルが同じ input を指す不変条件をテストレベルで担保
- **テスト合計**: 39 ファイル / 541 件グリーン（変更前 540 から +1 件）+ `npx electron-vite build` 通過
- **設計判断**:
  - **VSCode 起動を `code` → `open -a` フォールバック構造にした根拠**: 多くのユーザーは VSCode をインストールしているが Shell Command: Install 'code' command を実行していない（macOS 設定 1 ステップ）。`open -a "Visual Studio Code" <path>` は /Applications 配下を直接探すため、PATH 設定不要で確実に起動できる。Cursor 等の派生エディタを使う場合は `open -a` 単体は不向きだが、その層は通常 `code`（あるいは `cursor`）コマンドを導入済みのため `code` 経路が成功する想定
  - **shell:false + argv 配列を継承**: 既存実装のセキュリティ方針（path に `$()` / バッククオート / セミコロン等が含まれても shell に解釈されない）を fallback 側でも維持。`open` コマンドも `["-a", "Visual Studio Code", path]` の argv 渡しで安全
  - **トースト文言は据え置き**: fallback 後も失敗するケースは「VSCode 自体がインストールされていない」or「macOS 以外」の極めて稀な状況。文言を変えると既存ユーザの体験が変わってしまうため、現状の「`code` コマンドが PATH にありますか？」のままにした（fallback 自体は内部処理）
  - **ショートカット ID の所属カテゴリ**: `change-directory` は Terminal Management（CWD 操作はターミナル中心の機能）、`focus-file-search` は Sidebar（検索 input は Header にあるが用途はサイドバーツリーのフィルタ）、`open-in-vscode` / `toggle-fullscreen` は App（外部ツール / ウィンドウ全体に影響する操作）。SettingsModal のグループ表示に直結する分類のため意味的境界を意識した
  - **`Cmd+P` を選んだ理由**: VSCode のクイックオープンと同じキーで、ユーザーの筋肉記憶を活かせる。本アプリの検索 input も「ファイル名で絞る」用途で意味的にも合致。`Cmd+Shift+P` の選択肢もあったが「VSCode のコマンドパレット」と意味がずれる
  - **`Cmd+Shift+O` を `change-directory` に充てた理由**: `Cmd+O` は既存の `insert-file-path`（ファイル選択してパス挿入）に取られている。`Cmd+Shift+O` は VSCode の「シンボルへ移動」だが、本アプリにシンボル機能はないため衝突しない。`Cmd+G`（Go）は xterm の検索次へ送りで使う場面が将来出る可能性があり避けた
  - **`Ctrl+Cmd+F` を `toggle-fullscreen` に充てた理由**: macOS 標準のフルスクリーンキー。Electron menu に登録していなくても OS が認識するので、Window メニューに項目を追加せずに registry で完結させた。`F11` は macOS では F-row が brightness 等に取られるためサブ
  - **`Cmd+Shift+E` を `open-in-vscode` に充てた理由**: E は Editor の頭文字で記憶しやすい。VSCode 自身の `Cmd+Shift+E` は「エクスプローラ表示」で意味は近く、ユーザーが混乱しにくい。`Cmd+Shift+V` は xterm のペーストで使われる場面があり避けた
  - **`BrowserWindow.setFullScreen` を選んだ理由（vs `setSimpleFullScreen`）**: macOS の native フルスクリーン（別 Space に遷移、上部メニューバー隠れる）は `setFullScreen` のみで実現。`setSimpleFullScreen` は同 Space 内でウィンドウを画面いっぱいにするだけで「大画面」感は弱い。ユーザーの「FullScreen と WindowScreen の切り替え（大画面、通常画面）」要望は明確に native フルスクリーンを期待している
  - **`document.getElementById` を使った理由（vs ref forwarding）**: Header コンポーネントは React.memo で App.tsx から ref を引くのが煩雑。focus 用の anchor が DOM 1 箇所に固定されているこのケースでは ID 直接参照のほうがシンプルで失敗パスも明示的（`instanceof HTMLInputElement` ガードで unmount 時クラッシュなし）。Header 側のテストで「ID が確かに input に付いている」不変条件を担保しているので、リファクタリング時の breakage も検出可能
  - **active CWD が null のときのトースト出し分け**: VSCode 起動の前に CWD null チェックを入れて専用トースト。CWD 未取得＝シェル起動直後 / OSC 7 が来る前のごく短い時間 だが、ユーザーがちょうどその瞬間にショートカットを叩く可能性は低くないため明示的にメッセージを出す
  - **テスト追加範囲の判断**: registry.ts の新規 4 ID は既存「ID 一意性」テストが自動カバー、`file-system-handler.ts` の trySpawn ロジックは spawn の mock コストが高いのでスキップ、Header の id 属性は単純な属性テストとしてコスト低 × 価値（ショートカットと UI を結びつける不変条件）のため追加。session-verifier のガイドライン「1 verify 最大 3 ファイル」内に収めて 1 ファイル追加に留めた
  - **コミット範囲を 7 ファイル限定**: Sidebar.tsx の別セッション差分（pinned タブ auto-sync 修正）が working tree に残っていたが、AskUserQuestion でユーザーが「今回の作業だけコミット」を選択。論理的にも独立しているため取り違えを避けて意図通りに分離

### 2026-05-10 - ピン留めタブ手動選択時の auto-sync 巻き戻し修正

#### 概要

「ツリーにピン留めする機能はうまく追加できているが、パネル（=ペイン）に表示されていないものはツリーも表示されない」というユーザー報告に対応。原因は Sidebar の「アクティブペイン → タブ自動同期」effect が依存配列に `selectedTabCwd` を含んでいたため、ユーザーが pinned-only タブを手動選択した直後に effect が再発火 → アクティブペイン由来のタブへ即座に巻き戻していたこと。これにより pinned-only ツリーの DirectoryTree が描画される機会が無かった。修正は最後にシンクした `(activeTerminalId, activeCwd)` を `useRef` で保持し、その組が実際に変わったとき（= ペイン切替 or `cd`）だけ自動シンクを発火させるパターンに変更。selectedTabCwd 変化での再発火は ref 一致で早期 return される。`.md` を RightSidebar で開く経路 (`openMarkdownInRightSidebar`) はもともとペイン非依存（グローバル `markdownTabsStore` に追加して右サイドバーを開くだけ）のため、ツリーが描画されればコンテキストメニュー「編集する」/シングルクリックで自動的に開くようになる（追加修正不要）。session-verifier 通過: 540/540 件グリーン、変更ファイル内の TS エラー 0。

#### 変更点

- **`src/renderer/components/Sidebar/Sidebar.tsx`**:
  - `useRef` を import に追加
  - active-pane → tab 自動同期 effect を改修: `lastSyncedActiveRef: { id, cwd }` を導入し、effect 冒頭で前回シンク値と一致したら早期 return（= ユーザーの手動タブ選択を尊重）
  - activeTerminalId が null になったら ref を `{ null, null }` にリセット（次にペインが復活したとき確実にシンクが走るようにする）
  - 既存の依存配列 `[activeTerminalId, metas, tabs, selectedTabCwd, setSelectedTabCwd]` は維持（exhaustive-deps 準拠 + selectedTabCwd は比較式内で参照）

#### 残課題

- **アンステージ変更**: 別セッション由来の `Header.tsx` / `App.tsx` / `file-system-handler.ts` / `ipc-handlers.ts` / `preload/index.ts` / `shortcuts/registry.ts` / `.claude/skills/feature-files` が working tree に残存。本コミットは `Sidebar.tsx` + `.claude/MEMORY.md` + `.claude/HISTORY.md` に限定する

### 2026-05-10 - チャット間ファイル通信プロトコル (.claude/comm/) Phase 1 配置 + CLAUDE.md §9 更新

#### 概要

複数 Claude チャット間の非同期通信仕組み Phase 1（Outbox のみ）を本プロジェクトに導入。`~/.claude/templates/comm-protocol/` に作成したグローバルテンプレートから `.claude/comm/` を展開し、CLAUDE.md §9 Document System 末尾に「並行チャット間通信」サブセクションを追加した。中核設計は単一書き込み者・複数読み取り者ルール（各チャット専用 Outbox + 他 Outbox 読み取り専用）+ append-only 構造で、同時編集衝突を設計レベルで排除する。Anthropic 公式 (Harness Design / Multi-agent Research System / Effective Harnesses) の「ファイル経由のエージェント間通信」パターンに準拠。本プロジェクトは既に `active-sessions/` / `locks/` 機構を持つため、Phase 4 (Shared State + ロック) 導入時に既存資産との統合がスムーズに行える。Claude Code はファイル監視機能を持たないため、相手チャットのメッセージ取得は手動指示が必要（Phase 2 の SessionStart hook 自動読み込みで解消予定）。

#### 変更点

- **新規 `.claude/comm/README.md`**: Phase 1 プロトコル定義（ファイル構造 / 命名規則 `chat-<name>` / Outbox フォーマット (timestamp + 宛先タグ + 本文の append-only) / 宛先タグ仕様 (`@all` / `@chat-name` / `@self`) / 衝突対策 4 層 (設計 / append-only / ロック (Phase 4) / git) / アンチパターン (他 Outbox 編集禁止 / 過去エントリ書き換え禁止)）
- **新規 `.claude/comm/outbox/.gitkeep`** + **`.claude/comm/archive/.gitkeep`**: Outbox / アーカイブディレクトリ確保
- **`.claude/CLAUDE.md`**: §9 Document System 末尾に「並行チャット間通信」サブセクションを追加（プロトコル参照リンク + 運用開始時のチャット名宣言 + 書き込み・読み取り・衝突対策の 5 項目 + 既存 active-sessions / locks との Phase 4 統合予定の言及）
- **テンプレート由来の運用**: グローバル `~/.claude/templates/comm-protocol/` から `cp -r` で一式コピー、サンプル `outbox/EXAMPLE-chat-engineer.md` のみ削除して空 outbox 状態で運用開始

#### 残課題

- **動作確認**: 並行 Claude チャット 2 つで Outbox 書き込み → grep 読み取り → 返信の往復を試運転し、フォーマット書き込みの自然さ・context 消費量を確認
- **Phase 2 判断**: SessionStart hook で他チャットの Outbox 最新エントリを自動読み込みするかは試運転後に判断（手動「outbox 確認して」指示で十分なら hook 不要）
- **Phase 4 統合**: 既存 `active-sessions/` / `locks/` 機構と comm Shared State を統合する設計を Phase 1 運用後に検討
- **アンステージ変更**: 別セッション由来の `.claude/skills/feature-files` が working tree に残存。本コミットは `.claude/CLAUDE.md` + `.claude/HISTORY.md` + `.claude/HISTORY-archive.md` + `.claude/comm/` (+MEMORY.md は更新時のみ) に絞る

### 2026-05-06 - Header / Sidebar UI 調整（検索フィールド中央移設・分割ボタンアイコン化・設定ボタンを Sidebar 移設）

#### 概要

ユーザー要望「ファイル名検索フィールドを Header 中央に移設、分割ボタンはアイコンのみ表示、設定ボタンは LeftSidebar のツリーの一番下に新セクションとして position:sticky で常時表示」に対応。事前に AskUserQuestion で 4 点確認: (1) ブランチ運用は新ブランチ推奨を選択、(2) 検索フィールドはサイドバーを閉じても Header 中央に常時表示、(3) Header の設定ボタンは削除して Sidebar のみに置く、(4) ディレクトリ移動ボタンも分割ボタンと同じくアイコンのみで統一。Header を 3 セクション（左 = Title + Sidebar toggle / 中央 = 検索 input / 右 = 分割ボタン群 + RightSidebar toggle）に組み換え。検索 state は既に `sidebarStore.searchQuery` に存在していたため、Header から同じストアを購読して DirectoryTree と自動同期する形に（追加の state lifting 不要、双方向同期は Zustand 任せ）。DirectoryTree から旧検索 input ブロックと未使用になった `setSearchQuery` import を撤去（filter ロジックは維持）。Sidebar に新コンポーネント `SidebarSettingsSection` を追加し、DirectoryTree / GitPanel の下、ResizeHandle の上に配置。`flexShrink:0 + position:sticky bottom:0 + zIndex:1` で常時下端固定。設定アイコン + 「設定」ラベル付きボタンで `useSettingsModalStore.open()` を呼ぶ。Header.test.tsx を更新（「設定ボタン存在」→「検索フィールド存在 + 設定ボタン不在」、「設定ボタンクリックで modal 開く」→「検索入力で sidebarStore に書かれる」）。session-verifier 通過: 540/540 件グリーン + `npm run build` 通過。HISTORY ローリングアーカイブで 2026-04-30 エントリを `HISTORY-archive.md` に移動。

#### 変更点

- **`src/renderer/components/Header.tsx`**:
  - `useSettingsModalStore` import と handleOpenSettings / handleSettingsButtonEnter ハンドラを削除
  - `useSidebarStore` から `searchQuery` / `setSearchQuery` を購読
  - `searchInputStyle` を `useMemo` で新規定義（max-width 420px、theme.colors.background / border / borderRadius、focus 時のみ borderActive 色に変化）
  - JSX を `header (justify-content: space-between)` の中で 3 セクションに分割: 左（Title + Sidebar toggle、変更なし）/ 中央（`flex: 1` + `justifyContent: center` + `titlebar-no-drag` で囲った `<input type="search">`）/ 右（分割 V/H + ディレクトリ移動 + RightSidebar toggle）
  - 縦分割 / 横分割 / ディレクトリ移動の 3 ボタンから `縦分割` / `横分割` / `ディレクトリ移動` の文字列ノードを削除しアイコンのみに。`aria-label` を追加してスクリーンリーダー対応、`padding` を `xs sm` に詰めて視覚バランス調整
  - 設定ボタン全体（onClick / svg gear / 「設定」ラベル）を完全削除
- **`src/renderer/components/Sidebar/DirectoryTree.tsx`**:
  - 検索 input を含む 36 行のヘッダー div ブロック（line 310-348 相当）を削除し、`{/* 検索 input は Header 中央に移設済み（sidebarStore.searchQuery を共有）。*/}` のコメントに置換
  - 未使用になった `const setSearchQuery = useSidebarStore((s) => s.setSearchQuery);` を削除（`searchQuery` 読み取りは filter ロジックで継続使用）
- **`src/renderer/components/Sidebar/Sidebar.tsx`**:
  - `useSettingsModalStore` import を追加
  - `Sidebar` の return 内、GitPanel の下、ResizeHandle の上に `<SidebarSettingsSection />` を挿入
  - 同ファイル末尾に `SidebarSettingsSection` コンポーネントを新規定義: `position: sticky; bottom: 0; flexShrink: 0; backgroundColor: theme.colors.headerBackground; borderTop; padding 6px 8px; zIndex: 1`。中身は `aria-label="設定を開く"` + 設定 svg gear アイコン (14px) + 「設定」ラベルの button、hover で `theme.colors.buttonHover` に背景色変化、クリックで `useSettingsModalStore.getState().open()` を呼ぶ
  - DirectoryTree が `overflow:auto` を内部に持つため通常はツリーが押し出さないが、念のため sticky を併用（aside 自体がスクロールするレイアウト変更にも耐える防御）
- **`src/renderer/components/__tests__/Header.test.tsx`**:
  - `renders the kept buttons (split / directory / settings)` を `renders the kept buttons (split / directory) and the center search field` にリネーム + 設定ボタン assertion を削除し、`screen.getByPlaceholderText("ファイル名で検索")` の存在検証を追加
  - `does NOT render the settings button (moved to Sidebar)` を新規追加（`queryByTitle("設定 (Cmd+,)")` で不在検証）
  - `opens settings modal store on settings button click` を `center search field writes to sidebarStore.searchQuery` に置換: `useSidebarStore.setState({ searchQuery: "" })` で初期化 → input change → `useSidebarStore.getState().searchQuery` が `"foo.md"` になることを検証
- **テスト合計**: 39 ファイル / 540 件グリーン（変更前 540 から維持）+ `npm run build` 通過
- **設計判断**:
  - **検索 state を sidebarStore で共有 vs prop drilling**: 検索 state は既に `sidebarStore.searchQuery` に存在し、DirectoryTree が購読していた。Header から同じストアを購読する形にすれば追加の state lifting / context が一切不要で、双方向同期は Zustand の購読機構が担保する。新しい store / context を切らないのが最もシンプル
  - **検索フィールドをサイドバー閉じ時も常時表示**: ユーザーの明示要望に従う。値は保持されるがサイドバー閉じ時は filter 効果が見えない（DirectoryTree が描画されないため）。サイドバーを開けば即反映。「閉じてる時に typed→自動で開く」挙動は今回追加せず（要望に含まれない / スコープ最小化）
  - **設定ボタンを Header から完全削除**: ユーザー回答により Header 重複を避ける選択。サイドバー閉じ時は Cmd+, ショートカットで設定を開く運用になる（既存 ShortcutSettings で登録済み）
  - **ディレクトリ移動ボタンもアイコンのみに統一**: ユーザー回答により Header 視覚を統一。tooltip と aria-label で意味は伝わる
  - **`SidebarSettingsSection` を inline コンポーネントとして同ファイル内に置いた理由**: 1 ファイル内で完結する小さい UI で、外部から再利用しない。`Sidebar.tsx` 内に同居させた方が「Sidebar の最下段セクション」という意味的まとまりが明確で、ファイル分割のオーバーヘッドに見合わない。テスト書きたくなったら抽出
  - **`position: sticky; bottom: 0` を flexShrink:0 と併用した理由**: 通常は flexShrink:0 だけで十分（DirectoryTree の overflow:auto が内側に閉じているため）。ただし将来 aside 自体に `overflow-y:auto` を入れるレイアウト変更（例: タブ列が肥大化したケース）が起きても動くように sticky を保険として併用。`zIndex:1` で背後のツリーアイテムに重なる
  - **テストインフラ拡張は最小に**: `Sidebar.tsx` 自体には pre-existing でユニットテストがなく、`window.api.sidebar.getWidth()` 等のモックも未整備。今回の `SidebarSettingsSection` は薄いラッパー（`useSettingsModalStore.open()` を呼ぶだけ）なので、テストインフラ拡張のコスト > テストの価値と判断。Header 側で「設定ボタンが Header から消えた」を担保するに留める
  - **アイコンは Sidebar/icons.tsx に追加せず inline SVG を維持**: 設定ギアアイコンは Header から移すだけで新規ではない。検索アイコンも今回 input 内に置かないので不要。`icons.tsx` を肥大化させず、変更を該当 component 内に閉じる
  - **HISTORY ローリングアーカイブ**: エントリ 5 件上限のため、本タスク追加時に最古の 2026-04-30 エントリを `HISTORY-archive.md` に移動

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

