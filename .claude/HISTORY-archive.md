# HISTORY-archive.md - 変更履歴アーカイブ

HISTORY.md のローリングアーカイブ。エントリが 5 件を超えた際に古いものをここへ移動する（降順、最新が先頭）。

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
