# CLAUDE.md — Terminal Division

> 本プロジェクトの設計判断・実装規約の SSOT（Single Source of Truth）。400 行以下を目標に保つ。
> 抽象構想・設計原則は `.claude/docs/vision/` に分離。Claude Code は起動時に本ファイルを auto-load する。

---

## 0. Meta

### 役割と更新ルール

- **役割**: 現状の実装規約・アーキテクチャの唯一の参照点（400 行以下目標）
- **抽象構想・設計原則**: `.claude/docs/vision/` 参照（本ファイルに持ち込まない、ADR は作らない）
- **実装変更を伴う変更**: コードと同一 PR で本ファイル更新
- **新機能追加**: §8 Feature Tier Map に追記 + `.claude/docs/requirements/` に詳細記入

### 関連ドキュメント

| パス                                       | 用途                                                        |
| ------------------------------------------ | ----------------------------------------------------------- |
| `.claude/MEMORY.md`                        | タスクトラッカー（進行中 / 直近完了 / 予定）                |
| `.claude/HISTORY.md`                       | 変更履歴（セッション単位）                                  |
| `.claude/docs/vision/core.md`              | Core Identity / Target User / Value Proposition / Non-Goals |
| `.claude/docs/vision/coding-principles.md` | 設計原則（旧 ADR 役割）                                     |
| `.claude/docs/requirements/`               | Tier 1-3 機能要件定義                                       |
| `.claude/docs/known-issues/INDEX.md`       | 未解決 Issue + Root Cause                                   |
| `.claude/docs/code-explanation/`           | 機能別コード解説（学習教材）                                |
| `.claude/archive/`                         | 完了済みプラン                                              |
| `.claude/YYYY-MM-DD-<slug>.md`             | アクティブな実装プラン（完了後 archive/ へ移動）            |

---

## 1. Vision（要約）

> 詳細は [`docs/vision/core.md`](./docs/vision/core.md)

- **1-line**: macOS ネイティブで使える軽量な iTerm2 ライクなターミナル分割アプリ
- **Primary user**: macOS で複数プロセスを並走させたい開発者（ビルド監視 / ログ tail / 対話シェル）
- **Value**: 直感的な iTerm2 スタイル分割、日本語 IME 完全対応、CWD 継承 + Dock 統合、パッケージ版でも壊れないシェル環境
- **Non-Goals**: tmux 代替、クロスプラットフォーム第一級サポート、プラグイン API、複雑なプロファイル、7 ペイン以上

---

## 2. Platform / Tech Stack

| カテゴリ         | 技術                            | バージョン   |
| ---------------- | ------------------------------- | ------------ |
| Runtime          | Electron                        | 33.x         |
| Build            | electron-vite（Vite 5）         | 2.x          |
| UI               | React + TypeScript              | 18.x / 5.7.x |
| Terminal 描画    | @xterm/xterm                    | 5.5.x        |
| Terminal Backend | node-pty（native）              | 1.x          |
| State            | Zustand                         | 5.x          |
| Layout           | react-resizable-panels          | 4.x          |
| Test             | Vitest + @testing-library/react | 4.x / 16.x   |
| Distribution     | electron-builder                | 25.x         |

対応 OS: macOS（一級）。ビルドは Windows も通るが UI / IME / ロケールは macOS 中心に最適化。

---

## 3. Architecture

### 3.1 3 プロセスモデル

- **Main** (`src/main/`): ウィンドウライフサイクル、PTY 管理、IPC ハンドラ、Dock メニュー、最近のディレクトリ永続化
- **Preload** (`src/preload/`): `contextBridge` で `window.api.*` を Renderer に公開
- **Renderer** (`src/renderer/`): React UI、xterm.js、Zustand ストア、ショートカットキー

セキュリティ: `contextIsolation: true` / `nodeIntegration: false`。全ネイティブ機能は `window.api` 経由のみ。詳細は `docs/code-explanation/02-electron-basics.md`。

### 3.2 レイアウトシステム（二分木）

- `TerminalPane`（葉）: 1 ターミナル = 1 xterm.js インスタンス
- `SplitNode`（内部）: `direction` ∈ {`horizontal`, `vertical`} と `children: [string, string]`
- 全ノードは `Map<string, LayoutNode>` にフラット格納、`parentId` / `children` で親子参照
- `rootId` でルートを追跡、`MAX_TERMINALS = 6`
- 再帰レンダリング: `SplitContainer.tsx` の `renderNode()`、`react-resizable-panels` の Group/Panel/Separator

詳細: `docs/code-explanation/04-layout-and-state.md`。

### 3.3 Terminal ライフサイクル

1. `terminalStore.splitTerminal()` → 二分木更新 + 新ノード作成
2. `TerminalPane.tsx` mount → `terminalManager.getOrCreate(id)` で xterm.js インスタンス + リスナーを 1 度だけ登録
3. `terminalManager.attachToContainer()` で DOM に `terminal.open()`、IME composition リスナーを初回登録
4. IPC `pty:create` で Main 側の `node-pty` プロセス起動
5. データフロー: `xterm.onData` → IPC `pty:write` → node-pty → IPC `pty:data` → `xterm.write`

詳細: `docs/code-explanation/03-data-flow.md`。

### 3.4 PTY Manager

- `$SHELL` 起動、未設定時は `/bin/zsh`
- 日本語ロケール固定: `LANG=ja_JP.UTF-8` / `LC_ALL=ja_JP.UTF-8` / `encoding: 'utf8'`
- nvm 互換: `npm_*` 環境変数を除去
- 大量ペースト（>512B）: bracket paste（`\x1b[200~` / `\x1b[201~`）+ 1024B チャンク + 10ms 間隔

### 3.5 IME Composition

- xterm.js 内部 `<textarea>` に `compositionstart` / `compositionend` を直接フック
- コンポジション中の非 ASCII 文字は `onData` でスキップ（ASCII 制御文字は通す）
- `compositionend` 送信後、xterm.js の `setTimeout(0)` 再 dispatch を `lastCompositionData` で dedup

詳細: `docs/code-explanation/05-advanced-features.md`。

### 3.6 ショートカット

`App.tsx` で `window` の `keydown` を **capture phase** で監視し、xterm.js 到達前に処理。IME 中（`isComposing || keyCode === 229`）は無効化。一覧は §8 / `docs/requirements/tier-2-supporting.md` / `ShortcutsModal.tsx`。

### 3.7 セッション永続化

- 永続先: `app.getPath("userData")/session-state.json`
- 保存対象: レイアウト二分木（`nodes` + `rootId`）と各葉ペインの CWD のみ。実行中プロセス・コマンド履歴・ウィンドウサイズは対象外
- 保存トリガ: Renderer の `sessionPersist.ts` が `terminalStore` / `terminalMetaStore` を購読し、レイアウト構造変化と CWD 変化のみ検出。renderer 側 200ms debounce で IPC 送信（`session:save`）→ Main 側 `SessionStateManager` がさらに 250ms debounce してファイル書込
- 復元フロー: 起動時に `main.tsx` が `window.api.session.getRestoreData()` を await し、結果があれば React マウント前に `restoreSession()` でストアを差し替える。最初のウィンドウだけが復元データを受け取る（`session:getRestoreData` ハンドラ内で `sessionRestoreConsumed` フラグ管理、Dock 経由の追加ウィンドウは `initialCwd` 優先）
- 検証: version、ノード数 ≤ 11（葉 6 + 分岐 5）、葉 ≤ 6、`rootId` 存在、parentId/children 整合、サイクル・孤立ノード検出。1 つでも違反したら全体破棄して単一ペインで起動
- CWD 不存在ケース: 保存 CWD のディレクトリが起動時に存在しなくても PTY 側で HOME に落ちる（既存挙動）。レイアウト構造は維持
- 実装ファイル: `src/main/session-state.ts` / `src/main/types/session-state.ts` / `src/renderer/services/sessionRestore.ts` / `src/renderer/services/sessionPersist.ts`

### 3.8 Dock / Window Manager

- OSC 7 で CWD を追跡 → `RecentDirectoryManager` が JSON 永続化（最大 10、ホーム除外、重複除去、存在チェック）
- Dock メニューは「新しいウィンドウ」+ 最近のディレクトリ（`~` 短縮）で動的構築
- `window-manager.ts` の `initialCwd` 経由で Dock 起動ウィンドウに CWD を伝搬

---

## 4. Data Model

### 4.1 レイアウトノード

```typescript
// src/renderer/src/types/layout.ts
interface TerminalPane {
  id: string;
  parentId: string | null;
}
interface SplitNode {
  id: string;
  type: "split";
  direction: "horizontal" | "vertical";
  children: string[]; // 常に 2 要素
  parentId: string | null;
}
```

型ガード: `isTerminalPane(node)` = `!('type' in node && node.type === 'split')`。`layoutUtils.ts` に統合。

### 4.2 Zustand ストア

| Store               | 役割                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------ |
| `terminalStore`     | `nodes` / `rootId` / `activeTerminalId` / `terminalCount` / split / close / canSplit |
| `terminalMetaStore` | ペイン別メタデータ（分割時 CWD 継承等）。`initMeta` は既存チェック付き（上書き防止） |
| `themeStore`        | テーマ ID と同期通知                                                                 |

### 4.3 永続化

- `RecentDirectoryManager`: JSON（app userData 配下）で最大 10 件のディレクトリ履歴を保持
- レイアウト自体は永続化しない（T3-4 で検討中）

---

## 5. AI Integration

本アプリに AI 機能は含まれない。プロジェクト運用（CLAUDE.md、skills、plans、MEMORY/HISTORY）のみ Claude Code を使う。

---

## 6. Coding Standards

### 6.1 命名規則

- TypeScript: `strict` モード、公開 API に明示的な返り値型
- React: 関数コンポーネント + hooks（class 禁止）
- Export: named export を優先（default export 禁止、ルート `main.tsx` のみ例外）
- ファイル名: コンポーネントは `PascalCase.tsx`、その他は `camelCase.ts`
- IPC チャネル名: `domain:action`（例: `pty:create`, `recentDirs:add`）

### 6.2 言語

- コメント: 日本語
- 識別子 / コミットメッセージ / ブランチ名 / PR タイトル: 英語
- ユーザー向け文字列（UI / エラー）: 日本語

### 6.3 パターン

設計原則の「なぜ」は `docs/vision/coding-principles.md`。実装規約として守るべきこと:

- **xterm.js インスタンス管理**: `terminalManager.ts` のモジュールスコープ `registry` に配置し、React ライフサイクルから独立させる
- **`destroy()` は Zustand の `closeTerminal()` からのみ呼ぶ**（`useEffect` クリーンアップで呼ばない）
- **PTY 直接書き込みで履歴に影響するものは `terminalManager` 経由**（Cmd+Backspace の教訓。Known Issue 002）
- **パスエイリアス**: `@` → `src/renderer/` (`electron.vite.config.ts:19-21`)
- **native モジュール外部化**: `node-pty` を Vite の `external` に指定
- **ショートカットの capture phase 登録**: `window.addEventListener("keydown", handleKeyDown, true)`
- **外部 URL オープン**: `http://` / `https://` のみ許可（`ipc-handlers.ts` の `shell:openExternal`）

---

## 7. Development Workflows

### 7.1 開発コマンド

```bash
npm run dev            # electron-vite dev（ホットリロード）
npm run build          # プロダクションビルド
npm run preview        # ビルド結果プレビュー
npm test               # Vitest（単体テスト）
npm run test:ui        # Vitest UI
npm run test:coverage  # カバレッジ
npx electron-builder --mac --dir   # macOS パッケージ（dir）
npx electron-builder --mac         # macOS DMG
```

`postinstall` で `electron-builder install-app-deps` が自動実行され、`node-pty` の native モジュールが Electron 用に再ビルドされる。

### 7.2 コミット規約

```
<type>: <subject>
```

type: `feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore`

### 7.3 デバッグ要点

- 類似バグ遭遇時はまず [`docs/known-issues/INDEX.md`](./docs/known-issues/INDEX.md) を確認・キーワード grep
- パッケージ版でのみ発生するバグは `LSEnvironment` / PATH 解決 / PTY encoding を疑う（Known Issue 001）
- IME / ショートカット関連は `terminalManager.ts` の `[onData]` / composition ログを有効化
- React の二重マウントで PTY が二重生成されそうな場合は `ptyCreated` フラグと `setTimeout(0)` の順序を確認
- OSC 7 の CWD 追跡が動いていなければシェル側の `PROMPT_COMMAND` / `precmd` を確認

### 7.4 品質ゲート

- PR 前に `npm test` と `npm run build` を通す
- 新規 PTY 直接書き込みを追加する際は「履歴管理が必要か」をレビューチェック項目に含める

---

## 8. Feature Tier Map

> 詳細は [`docs/requirements/`](./docs/requirements/README.md) 参照

### Tier 1: コア（Value Proposition を直接支える）

- **T1-1**: iTerm2 スタイルのペイン分割（二分木、最大 6、ドラッグリサイズ、Cmd+W 兄弟昇格、Cmd+Option+Arrow フォーカス）
- **T1-2**: xterm.js + node-pty によるネイティブシェル（PATH 多層フォールバック、日本語ロケール、bracket paste）
- **T1-3**: 日本語 IME 入力の完全サポート（compositionstart/end 直接フック、dedup、`LSEnvironment`）
- **T1-4**: CWD 継承と Dock 統合（分割時継承、OSC 7 追跡、最近のディレクトリ）

### Tier 2: 補助（あると価値が大幅増）

- **T2-1**: ショートカットキー体系（capture phase、IME ガード）
- **T2-2**: フォーカス視覚フィードバック（オレンジ枠線、textarea focus 同期）
- **T2-3**: 外部リンクとディレクトリ移動（WebLinks、ネイティブダイアログ）
- **T2-4**: 単一テーマとスタイル
- **T2-5**: 左サイドバー（CWD 別縦タブ + lazy ディレクトリツリー + chokidar watch + ファイル操作 / 削除・移動・名称変更・cd・VSCode 起動）。Header の Title 右隣のトグルで開閉、幅のみ永続化
- **T2-6**: サイドバー D&D（ツリー内移動 / 外部 Finder からのコピー / OS ネイティブ drag によるツリー外搬出 / ターミナルへのパス挿入）と Undo/Redo（rename・move・trash の 50 件スタック、ゴミ箱追跡復元、サイドバー上部アイコン）、ファイル右クリックメニューでの相対/フルパスコピー（アクティブ ターミナル CWD 起点）
- **T2-7**: セッション永続化（レイアウト二分木 + 各ペインの CWD のみ JSON 永続化、起動時に最初のウィンドウへ復元、検証失敗時はサイレントフォールバック、multi-window はスコープ外）
- **T2-8**: ペイン内 Markdown エディタ（CodeMirror 6、`.md` / `.markdown` のみ、サイドバー右クリック → 「編集する」起動、ペインヘッダーに CLI / MD タブ、Cmd+S 保存・Cmd+Z/Cmd+Shift+Z で履歴、未保存時のタブ切替・別ファイル・Cmd+W で警告モーダル、`viewMode=md` の間も PTY は `display:none` で生存し CLI 復帰時に状態保持。MD 状態自体はセッション永続化対象外）
- **T2-9**: スクロールバック削除メニュー（ヘッダーのゴミ箱アイコン → ポップオーバーで「全消去 / 直近 100・500・1000 行残す / 完全リセット」を選択。部分削除は `terminal.options.scrollback` の一時的な引き下げで trim を発火、microtask で元値復帰）
- **T2-10**: カスタマイズ拡張（`AppSettings` に `terminal` / `editor` / `general` を追加して永続化。タブ「ターミナル」「エディタ」「一般」で UI 提供。ターミナル: フォントサイズ / ファミリー / 行間 / カーソルスタイル + blink / scrollback / Bell（none/visual/sound）/ 単語区切り / デフォルトシェル / デフォルト CWD。エディタ: フォントサイズ / ファミリー / softWrap。一般: セッション復元 ON/OFF / PTY 異常終了通知。フォントズーム: `Cmd+=` / `Cmd+-` / `Cmd+0` がアクティブペインの揮発オーバーライドを操作（per-pane delta、session-persist 対象外）。ペインタイトル: SubHeader をダブルクリックで rename、空文字列確定で自動表示（CWD 由来）に戻る）

### Tier 3: 実験 / 凍結候補

- **T3-1**: タブ機能（未定）
- **T3-2**: プロファイル / テーマ管理（凍結）
- **T3-3**: シェル統合（OSC 133、候補）
- **T3-4**: テスト環境整備強化（随時追加）

---

## 9. Document System

### Vision → 実装プラン → 統合 フロー

1. **Vision**（抽象・設計原則）: `docs/vision/` に記述。ADR は作らず vision/ に一元化
2. **実装プラン**（具体）: `.claude/YYYY-MM-DD-<slug>.md` 作成 → Vision から相互リンク
3. **完了**: プランを `archive/` に移動、実装規約は本ファイルに統合、背景・判断理由は `vision/coding-principles.md` に残す
4. **MEMORY.md / HISTORY.md**: セッション単位で task-tracker 経由同期

### なぜ ADR を使わないか

- ADR は「時点の判断」を記録するため、時間経過で古い情報を参照してしまうリスクがある
- `vision/` は「現在から未来に向けた設計原則」として継続更新されるため、常に最新の意思決定を反映
- 過去の却下案・判断理由は `vision/coding-principles.md` の更新フローに従って残す

### Known Issue ライフサイクル

`docs/known-issues/` は **壊れている／壊れていた箇所の Root Cause と再発防止知見** を置く場所（MEMORY.md / HISTORY.md では拾えないもの）。

1. **発見時**: `NNN-<slug>.md` を `_TEMPLATE.md` ベースで作成、Status=Active、`INDEX.md` 更新
2. **解決時**: Status=Fixed、Resolved 日付 / 修正箇所 / Lessons Learned 追記、`INDEX.md` の Active → Fixed 移動
3. **Monitoring**: 将来の落とし穴になりうる構造的問題は Monitoring で保持

### skills/

プロジェクト固有のスキルと、グローバルスキルへのシンボリックリンクを `.claude/skills/` 配下に配置。実体は `~/dev/Claude/skill-lib/` で一元管理（グローバル運用ルール参照）。
