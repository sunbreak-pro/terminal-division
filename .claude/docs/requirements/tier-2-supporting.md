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
