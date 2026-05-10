# HISTORY.md - 変更履歴

### 2026-05-10 - RightSidebar 全画面モード + Markdown ペイン分割機能（最大 6 / 二分木 / ペイン別タブ列）

#### 概要

ユーザー要望「RightSidebar 内でも分割機能を実装させたい。さらに RightSidebar の幅を 100%（leftSidebar とは被らない）の全画面モードも実装したい」に対応。事前に AskUserQuestion で 4 点確認: (1) 分割の中身は「Markdown 同士の分割（タブは併存）」、(2) 最大ペイン数は「メインと同じ 6」、(3) 全画面起動方法は「Header にトグルボタン追加」、(4) 全画面時のメインターミナルは「完全に隠す（display:none で生存）」。実装は 2 フェーズ。Phase 1（全画面）: `rightSidebarStore` に `isFullscreen` / `toggleFullscreen` を追加（fullscreen 化時はサイドバーを自動オープン、closeOpen と連動して fullscreen も解除）、`right-sidebar-state.json` に永続化フィールド追加、IPC `rightSidebar:get/setFullscreen` 追加、Header に拡大/縮小アイコンのトグル button 追加、App.tsx で fullscreen 時にメインターミナル領域を `display:none` + flex 0（PTY/xterm はインスタンス保持で復帰時に状態維持）。Phase 2（ペイン分割）: 旧 `markdownTabsStore.activeTabId` を廃止して「グローバルなタブ集合」のみに縮小、新規 `markdownLayoutStore` に二分木 + 各葉ペインの `tabIds[]` / `activeTabId` を持たせ、最大 6 ペイン。`MdSplitContainer` (react-resizable-panels で再帰描画) + `MdPaneView` (ペインヘッダー: タブ列 / `+` ファイル追加 / 縦分割 V / 横分割 H / クローズ) の 2 コンポーネントを新設し、RightSidebar 本体は aside + ResizeHandle + MdSplitContainer に簡素化。`markdownOpenService.openMarkdownInRightSidebar` は `attachTabToActivePane(tabId)` を呼んでアクティブペインに紐付け、既存タブの場合は所属ペインを active 化（同パスを別ペインで重複表示しない不変条件）。`UnsavedChangesModal` の reason に `close-pane` を復活させ、ペイン閉じ時の dirty タブ警告に対応。session-verifier 通過: 548 → 553 件グリーン（rightSidebarStore +5、markdownLayoutStore +11、markdownTabsStore は activeTabId 廃止に合わせ書換）+ `npm run build` グリーン。

#### 変更点

- **新規 `src/renderer/types/mdLayout.ts`**: `MdPane` (`{ id, parentId, tabIds: string[], activeTabId: string | null }`) / `MdSplitNode` (`{ id, type:'split', direction, children, parentId }`) / `isMdPane` 型ガード。`SplitDirection` は terminalStore から流用
- **新規 `src/renderer/stores/markdownLayoutStore.ts`**: 二分木 store。`MAX_MD_PANES = 6` / `splitPane` (新葉を兄弟として追加し新葉を active 化) / `closePane` (兄弟を昇格、最後の 1 葉は閉じない) / `attachTabToActivePane` (既存所有ペインを優先 active 化、なければ active ペインに append) / `setPaneActiveTab` / `removeTabFromPane` (左隣 fallback 含む) / `findPaneByTabId` / `resetToSinglePane` (テスト用) + `collectMdPaneIdsInOrder` で DFS 葉走査。Map のミューテーションは常に new Map で wrap、`set` 内のサブスクライバ中間状態を回避
- **新規 `src/renderer/components/RightSidebar/MdSplitContainer.tsx`**: SplitContainer (terminal 用) と同じく `react-resizable-panels` の Group/Panel/Separator で二分木を再帰描画。Separator id は `md-handle-` プレフィックスでターミナル側と区別
- **新規 `src/renderer/components/RightSidebar/MdPaneView.tsx`**: 葉ペイン UI。タブ列 + `+` (ファイルピッカー起動) + 縦分割 / 横分割 / クローズボタン (1 ペイン時はクローズ非表示) + MarkdownEditor 表示エリア。クリック時に `setActivePane(paneId)` でフォーカス取得、active なペインは `boxShadow: inset 0 0 0 1px borderActive` で薄く強調。ペインクローズ時、dirty タブがあれば 1 件目を起点に `UnsavedChangesModal(reason="close-pane")` 警告 → 確認後 closePane + 全 tabIds を `markdownTabsStore.closeTab` で消す
- **`src/renderer/stores/markdownTabsStore.ts`**: `activeTabId` / `setActive` を削除し「全タブの集合」のみ管理に縮小。`openMarkdown(filePath, content)` の戻り値型は維持（既存 `markdownOpenService` が tabId を期待）。`closeTab` は対象タブだけ削除、`clearAll` も同様
- **`src/renderer/stores/rightSidebarStore.ts`**:
  - `isFullscreen: boolean` + `setFullscreen` / `toggleFullscreen` を追加
  - `setFullscreen(true)` は同時に `isOpen=true` に倒す（fullscreen 化は必ずサイドバーを開く）
  - `setOpen(false)` / `toggleOpen()` で fullscreen 解除と同時に閉じる連動を追加（fullscreen のまま隠す中間状態を作らない）
  - 新セレクタ `useRightSidebarFullscreen`
- **`src/main/right-sidebar-state.ts`**: `RightSidebarState` に `isFullscreen` 追加。`load()` は型ガード後 state にセット、`getFullscreen` / `setFullscreen` を追加
- **`src/main/ipc-handlers.ts`**: `rightSidebar:getFullscreen` / `rightSidebar:setFullscreen` の 2 ハンドラを既存 setOpen の直下に追加
- **`src/preload/index.ts`**: `window.api.rightSidebar.{getFullscreen,setFullscreen}` を公開
- **`src/renderer/components/Header.tsx`**: 既存 `PanelRightIcon` トグル直後に「全画面切替」button を追加。fullscreen ON/OFF でアイコンを「縮小（4 角内向き矢印）/ 拡大（4 角外向き矢印）」で切替。pressed 状態は `borderActive` で視覚化
- **`src/renderer/App.tsx`**:
  - `useRightSidebarFullscreen` を購読
  - メインターミナル領域 (`<SplitContainer />` を内包する div) を fullscreen 時 `flex: '0 0 0' / display:'none' / width:0` に切替（PTY と xterm はマウントされたまま、復帰時の state 維持）
  - `Sidebar` (左) は常に表示維持（要件「leftSidebar とは被らない」を踏襲）
- **`src/renderer/components/RightSidebar/RightSidebar.tsx`**: 大幅簡素化。タブ列 / `+` ボタン / MarkdownEditor 直接配置はすべて `MdPaneView` に移譲。aside ルート + ResizeHandle (fullscreen 時は非表示) + `<MdSplitContainer />` の 3 構成に。fullscreen 時は `width:'100%' / flex:1 / borderLeft:'none'` で leftSidebar 隣に張り付き
- **`src/renderer/services/markdownOpenService.ts`**: `loadAndOpen` の `openMarkdown` 成功直後に `useMarkdownLayoutStore.getState().attachTabToActivePane(tabId)` を呼び、サイドバー自動オープンの直前で実行。既存テスト（モックは `openMarkdown` の戻り値型のみ依存）は破壊しない
- **`src/renderer/components/UnsavedChangesModal.tsx`**: `UnsavedReason` を `"open-other" | "close-pane"` に拡張、`close-pane` の文言「このペインを閉じると、編集中のタブが失われます。」を追加（旧仕様で一度削除されていた reason を復活）
- **`src/renderer/stores/__tests__/markdownLayoutStore.test.ts`** (新規 11 件): 初期 1 ペイン / splitPane で兄弟ペイン作成と active 切替 / `MAX_MD_PANES` で false / 最後の 1 ペインは閉じない / closePane で親 split 折り畳み + active 復帰 / attachTabToActivePane の append + activate / 既存所有ペインへの再 attach / removeTabFromPane の左隣 fallback / 全タブ消滅で `activeTabId=null` / `findPaneByTabId` のクロスペイン検索 / `collectMdPaneIdsInOrder` の DFS 順序
- **`src/renderer/stores/__tests__/rightSidebarStore.test.ts`** (+5 件): `setFullscreen(true)` でサイドバー自動オープン / `setFullscreen(false)` 時はサイドバー開いたまま / `toggleFullscreen` の往復 / `toggleOpen` 時に fullscreen も解除 / `setOpen(false)` 時に fullscreen も解除
- **`src/renderer/stores/__tests__/markdownTabsStore.test.ts`**: `activeTabId` 廃止に合わせて「returns the same tabId when same filePath」「removes the tab without affecting siblings」など 9 件を書き換え
- **テスト合計**: 40 ファイル / 553 件グリーン（変更前 548 から +5）+ `npm run build` 通過
- **session-verifier 経由の追加修正**: `markdownLayoutStore.attachTabToActivePane` が `state.activePaneId` の有無で `findPaneIdContainingTab` 呼び出しを分岐していたのを撤去（active が一時的に null でも所有ペインを優先して見つけるべきため）
- **設計判断**:
  - **markdownTabsStore から activeTabId を取り除いた理由**: 各ペインがそれぞれ独立したタブ列を持つ要件のため、グローバル 1 個の `activeTabId` は意味的に成立しない。ペイン分割なしの旧 UX では「サイドバー全体で 1 タブ active」だったが、分割導入で「ペインごとに 1 タブ active」に変わる。store を 2 段階（タブ集合 + レイアウト）に分けることで責務が明確になり、レイアウト永続化を見送る判断（CLAUDE.md §3.7 に沿って MD はセッション内のみ）も自然に成立
  - **同一ファイルの複数ペイン同時表示を禁止した理由**: `attachTabToActivePane` で「既存タブを持つペインがあればそちらを active 化」する不変条件にしたのは、`markdownEditorRegistry` が tabId 単位で 1 つの imperative API しか持てないため、同 tabId を 2 つの CodeMirror インスタンスで描画すると save/focus の宛先競合が起きること。仕様としても「同じファイルを並べて見たい」要望は今回出ていないため、シンプル側に倒した
  - **fullscreen と isOpen の連動**: 「fullscreen で閉じる」は中間状態として意味がない（次に開いたとき何幅で出すかが曖昧）。`setFullscreen(true)` で必ず `isOpen=true` にし、`toggleOpen() / setOpen(false)` で fullscreen も解除することで、(1) 通常表示 (2) 全画面 (3) 非表示 の 3 状態に絞り込む。永続化値読み込み時の race condition は既存 `openInitialized` パターンを踏襲して `fullscreenInitialized` フラグで対処
  - **メインターミナルを `display:none` で生存させる根拠**: T2-8 の MD タブで採用済みのパターンと同じ。PTY と xterm のインスタンスは React のライフサイクルから独立した `terminalManager` registry にあるので、display:none でも node-pty プロセスは生き続け、`xterm` の scrollback も保持される。fullscreen 解除で見た目が即復帰し、ユーザーが意図しない PTY 終了を起こさない
  - **ペイン分割を terminalStore と別 store にした理由**: 葉ノードの形が違う（terminal pane は `{id, parentId}` のみ、md pane は `tabIds[] / activeTabId` 持ち）ため共通化できない。重複コードがあるが、二分木操作は約 250 行で収まり、共通化のオーバーヘッド > 重複のコストと判断。`MdSplitContainer` も SplitContainer と似ているが、`paneNumber` / `terminalManager.fit` が無い分こちらが小さい
  - **新ペインを「空」で開始する選択**: 分割直後に元ペインのタブを引き継ぐ実装も検討したが、「同一ファイルを 2 ペインに見せる」が引き起こす registry 競合を避けるため断念。空ペインで開始 → ユーザーが `+` ボタンで明示的にファイルを選ぶ動線にした。空ペインのプレースホルダ「ファイルを選択してください」は既存 RightSidebar の空状態と同文言で統一感を維持
  - **ペインクローズ時の dirty 警告**: 1 件目の dirty タブを代表として `UnsavedChangesModal(close-pane)` を出す。複数 dirty が含まれる場合の「全部 save / 全部 discard / キャンセル」の理想 UX はあるが、本機能のメインフローではないため最小実装。ユーザーがキャンセルすればペインは閉じず、save/discard を選べば「ペイン全体を破棄して進める」割り切り
  - **icon を inline SVG で書いた理由**: 既存 Header / TerminalSubHeader と同じ作法に揃えた（`Sidebar/icons.tsx` には enter していない）。fullscreen トグルの 4 角矢印アイコンは設定アプリ等でも標準的で、命名のオーバーヘッドが見合わない
  - **HISTORY ローリングアーカイブ**: 5 件上限のため、本タスク追加時に最古の 2026-05-06 「VSCode 風 4 機能追加（Material アイコン / パス hover panel / ピン留めツリー / Git 連携）」エントリを `HISTORY-archive.md` に移動

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
