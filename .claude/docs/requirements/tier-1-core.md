# Tier 1 — コア機能

Value Proposition を直接支える、本アプリの存在意義そのものに当たる機能。すべて実装済み。

---

## T1-1: iTerm2 スタイルのペイン分割

### Purpose

ターミナルを縦横に分割し、複数の作業を 1 ウィンドウで並走させる。

### Boundary

- **含む**: `Cmd+D`（horizontal）/ `Cmd+Shift+D`（vertical）による分割、最大 6 ペイン、ドラッグによるリサイズ、兄弟昇格を含む `Cmd+W` による閉じる操作
- **含まない**: タブ、フローティングペイン、7 ペイン以上

### Acceptance Criteria

- [x] `Cmd+D` / `Cmd+Shift+D` で分割できる
- [x] 二分木（`TerminalPane` / `SplitNode`）で表現され、`rootId` と `parentId` で整合
- [x] `MAX_TERMINALS = 6` 制約を `canSplit()` で強制
- [x] `react-resizable-panels` によるドラッグリサイズが機能
- [x] `Cmd+W` でペインを閉じると兄弟が祖父母に昇格
- [x] `Cmd+Option+矢印` でフォーカス移動
- [x] 閉じた後でも残存ターミナルの入力・描画が正常動作

### Dependencies

- `terminalStore.ts`（Zustand）
- `SplitContainer.tsx`（再帰レンダリング）
- `react-resizable-panels`

---

## T1-2: xterm.js + node-pty によるネイティブシェル

### Purpose

ブラウザ UI（xterm.js）から本物のシェル（zsh 等）を PTY 経由で扱う。

### Boundary

- **含む**: `$SHELL` 起動、PATH 多層フォールバック、日本語ロケール固定、リサイズ伝搬、bracket paste
- **含まない**: SSH 接続、セッション永続化、シェルエミュレーション

### Acceptance Criteria

- [x] `$SHELL` 起動、フォールバックは `/bin/zsh`
- [x] 多層フォールバック PATH 解決（path_helper / well-known paths / nvm 自動検出）
- [x] `LANG` / `LC_ALL` を `ja_JP.UTF-8` に固定
- [x] `ResizeObserver` + `FitAddon` でサイズ変更を PTY に伝搬
- [x] 512B 以上は bracket paste + 1024B チャンク + 10ms 間隔で送信
- [x] パッケージ版でも `npm` / `brew` / `claude` 等が見つかる

### Dependencies

- `pty-manager.ts`
- `shell-integration.ts`（PATH 解決）
- `node-pty`

---

## T1-3: 日本語 IME 入力の完全サポート

### Purpose

xterm.js 標準では壊れる日本語（CJK）入力を完全に動かす。

### Boundary

- **含む**: compositionstart / compositionend の直接フック、非 ASCII の中間状態除外、二重送信の dedup
- **含まない**: IME ウィンドウの位置制御、ユーザー辞書連携

### Acceptance Criteria

- [x] ひらがな / カタカナ / 漢字の確定入力が成功
- [x] IME コンポジション中の `onData` で非 ASCII 文字がスキップされる
- [x] `compositionend` 直後の xterm.js 再 dispatch が `lastCompositionData` で dedup される
- [x] IME 中はショートカットキーが発火しない（`isComposing || keyCode === 229`）
- [x] ASCII 制御文字（矢印・Backspace）は IME 中でも通る
- [x] パッケージ版でも文字化けしない（`LSEnvironment` 設定）

### Dependencies

- `terminalManager.ts`（compositionstart/end ハンドラ）
- `electron-builder.yml`（LSEnvironment）
- Known Issue: [001](../known-issues/001-packaged-app-japanese-garbled.md)

---

## T1-4: 入力行 Undo / Redo

### Purpose

ターミナル入力を行単位で Undo / Redo できる（ブラウザの `Cmd+Z` 感覚）。

### Boundary

- **含む**: `Cmd+Z` / `Cmd+Shift+Z`、最大 100 履歴、PTY エコーバック除外、Cmd+Backspace / Ctrl+W / Ctrl+U / Backspace / Enter の履歴連動
- **含まない**: コマンドヒストリ（シェルの `history`）、複数行の Undo

### Acceptance Criteria

- [x] 文字単位ではなく「行状態」を undoStack に push
- [x] `MAX_UNDO_STACK_SIZE = 100` 超過時は最古を破棄
- [x] エコーバック除外 3 層（`undoRedoInProgress` / `pendingSentText` / 300ms タイマー）
- [x] 連続 Undo/Redo でタイマーが clearTimeout されリセットされる
- [x] Enter 確定時に履歴がクリアされる
- [x] Cmd+Backspace は `terminalManager.clearLine()` 経由で履歴記録を伴う
- [x] パッケージ版でもエコーバック遅延に耐える

### Dependencies

- `terminalManager.ts`（InputHistoryState / undo / redo / clearLine）
- `App.tsx`（ショートカット）
- Known Issue: [002](../known-issues/002-cmd-backspace-undo-history.md)

---

## T1-5: CWD 継承と Dock 統合

### Purpose

分割時に作業ディレクトリを引き継ぎ、ネイティブ Dock メニューから最近のディレクトリでウィンドウを開ける。

### Boundary

- **含む**: 分割時 CWD 継承、OSC 7 による CWD 追跡、Dock メニュー動的構築（最大 10 件、ホーム除外、重複除去）
- **含まない**: ブックマーク機能、ディレクトリ間の同期

### Acceptance Criteria

- [x] 分割時、新ペインの初期 CWD に元ペインの CWD をメタストア経由で設定
- [x] OSC 7 エスケープで CWD 変更を追跡し `recentDirs.add` に通知
- [x] `RecentDirectoryManager` が JSON 永続化・重複除去・ホーム除外・存在チェック・最大 10 件を実施
- [x] Dock メニューが `~` 短縮パスで最近のディレクトリを表示
- [x] Dock メニュー選択で `initialCwd` 付き新ウィンドウが開く
- [x] CWD 優先順位: メタストア（分割時） > windowInitialCwd（Dock） > undefined

### Dependencies

- `terminalMetaStore.ts` / `terminalStore.ts`
- `recent-directories.ts` / `dock-menu.ts` / `window-manager.ts`
- HISTORY 2026-03-15 エントリ参照
