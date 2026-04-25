# Tier 2 — 補助機能

Tier 1 のコア体験を補強する機能。実装済みだが中核ではない。

---

## T2-1: ショートカットキー体系

### Purpose

マウスに頼らずキーボードで全操作を完結させる。

### Acceptance Criteria

- [x] `Cmd+D` / `Cmd+Shift+D`: 縦/横分割
- [x] `Cmd+W`: ペインクローズ
- [x] `Cmd+Backspace`: カーソル位置から行頭まで削除
- [x] `Cmd+K`: カーソル以降削除
- [x] `Cmd+←` / `Cmd+→`: 行頭 / 行末
- [x] `Cmd+Shift+Arrow` / `Cmd+Shift+A`: 行選択
- [x] `Option+←` / `Option+→`: 単語移動（`ESC+b` / `ESC+f`）
- [x] `Option+Backspace` / `Option+D`: 単語削除
- [x] `Shift+Enter`: 改行挿入
- [x] `Cmd+Option+Arrow`: ペイン間フォーカス移動
- [x] `window` の capture phase で処理し xterm.js より先行
- [x] IME 中（`isComposing || keyCode === 229`）は無効化

### Dependencies

- `App.tsx`
- `ShortcutsModal.tsx`（一覧表示）

---

## T2-2: フォーカス視覚フィードバック

### Purpose

アクティブなペインをオレンジ枠線で可視化し、入力先を明確にする。

### Acceptance Criteria

- [x] アクティブペインに視覚的な枠線（オレンジ）が表示される
- [x] xterm.js の textarea フォーカスイベントで `setActiveTerminal` を同期
- [x] `onMouseDown` でフォーカス切り替え（`onClick` ではドラッグ時未発火）
- [x] 複数ペイン間の移動で漏れなく同期

### Dependencies

- `TerminalPane.tsx`
- `terminalManager.ts`（textarea focus listener）

---

## T2-3: 外部リンクとディレクトリ移動

### Purpose

ターミナル内の URL を Cmd+クリックでブラウザ起動、ヘッダーからネイティブ選択ダイアログで `cd`。

### Acceptance Criteria

- [x] `WebLinksAddon` で URL を検出、`Cmd`（mac）/ `Ctrl`（他）+ クリックで `shell.openExternal`
- [x] `http://` / `https://` のみ許可（プロトコル検証）
- [x] ヘッダーの「ディレクトリ移動」で `dialog.showOpenDialog({ properties: ['openDirectory'] })`
- [x] 選択パスをシングルクォートでエスケープし `cd '...'` を PTY に送信

### Dependencies

- `terminalManager.ts`（WebLinksAddon）
- `ipc-handlers.ts`（`dialog:selectDirectory`, `shell:openExternal`）
- `Header.tsx`

---

## T2-4: 単一テーマとスタイル

### Purpose

軽量性を優先し、統一された見た目を提供する。

### Acceptance Criteria

- [x] `theme.ts` で色 / スペーシングを集約
- [x] セパレーターはホバーで色変化（`SplitContainer.tsx`）
- [x] タイトルバー / スクロールバーのカスタムスタイル（`globals.css`）
- [x] xterm.js のテーマも `theme.ts` と同期

### Dependencies

- `theme.ts` / `globals.css` / `themeStore.ts`

---

## T2-7: セッション永続化

### Purpose

アプリ再起動時に前回のペイン分割構成と各ペインの CWD を復元し、ビルド監視 / ログ tail / 対話シェルなどの "作業セット" を毎回手動で組み直さずに済むようにする。

### Boundary

- **含む**: レイアウト二分木（`nodes` + `rootId`）の JSON 永続化、起動時の単一ウィンドウ復元、各葉ペインの CWD 復元、検証失敗時のサイレントフォールバック
- **含まない**: 実行中プロセスの復元、コマンド履歴、ウィンドウ位置・サイズ、Multi-window の同時復元

### Acceptance Criteria

- [x] 永続先は `app.getPath("userData")/session-state.json`
- [x] レイアウト変更（split/close）と CWD 変更（OSC 7）を契機に Renderer → Main で IPC 送信、Main 側 250ms debounce
- [x] 起動時に最初のウィンドウだけが復元データを受け取る（Dock 経由の追加ウィンドウは `initialCwd` 優先）
- [x] React マウント前に同期復元（`main.tsx` で `await getRestoreData()` → `restoreSession()`）
- [x] スキーマ version 不一致 / ノード数超過 / ツリー整合性違反は全体破棄して単一ペイン起動
- [x] PTY は新規生成、保存 CWD で起動。CWD が存在しなければ HOME に落ちる
- [x] 検証ロジックの単体テスト（Main 側 13 件、Renderer 側 11 件 + hydrate 4 件）

### Dependencies

- `src/main/session-state.ts` / `src/main/types/session-state.ts`
- `src/renderer/services/sessionRestore.ts` / `src/renderer/services/sessionPersist.ts`
- `src/renderer/main.tsx`（起動時復元呼び出し）
- `src/renderer/stores/terminalStore.ts`（`hydrateLayout`）
- `src/renderer/stores/terminalMetaStore.ts`（`hydrateMetas`）
