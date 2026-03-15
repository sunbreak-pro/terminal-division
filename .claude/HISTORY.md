# HISTORY.md - 変更履歴

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
