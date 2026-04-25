# HISTORY.md - 変更履歴

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

> 2026-04-25 ローリングアーカイブ: これ以前の 20 エントリは [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。
