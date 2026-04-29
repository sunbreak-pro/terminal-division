# Plan: Terminal/Editor Customization Features (T2-10)

> Status: COMPLETED
> Created: 2026-04-29
> Completed: 2026-04-29
> Task: T2-10 カスタマイズ拡張

## Context

ユーザー要望: フォントの拡大/縮小に加え、標準的なターミナル/AIエディタとして必要なカスタマイズ機能を一括で導入する。

### スコープ（高 + 中 優先度）

**高優先度（ターミナル基本機能の欠落補填）**

- フォントサイズズーム（Cmd+= / Cmd+- / Cmd+0）
- フォントファミリー選択
- 行間（lineHeight）
- カーソルスタイル（block / underline / bar）+ 点滅 ON/OFF
- スクロールバック行数
- Bell 動作（none / visual / sound）
- 単語選択区切り文字（wordSeparator）

**中優先度（QoL）**

- デフォルトシェル
- デフォルト CWD
- セッション復元 ON/OFF
- ペインタイトル手動 rename
- PTY 終了時通知
- Markdown エディタ設定（フォント / サイズ / 折り返し）

### 設計判断

- **フォントズームスコープ**: C（全体共通永続化 + ペイン毎揮発オーバーライド）
- **MD エディタへの Cmd+= 連動**: なし（ターミナルのみ）
- **ペイン毎オーバーライドは session-persist に含めない**（揮発、ウィンドウを閉じたらリセット）
- **クランプ範囲**:
  - フォントサイズ: 8〜32px
  - 行間: 1.0〜2.0
  - スクロールバック: 1000〜100000

### Non-Goals

- Vim モード / spell check（複雑度に対して効用が薄い）
- Per-window opacity（現状のグローバル opacity で十分）
- 背景画像

## Steps

### Phase 1: Settings 基盤拡張 + フォントズーム

- [ ] `src/shared/settings.ts` に `TerminalSettings` / `EditorSettings` / `GeneralSettings` を追加
- [ ] `validateAppSettings` / `mergeSettings` 拡張
- [ ] `settingsStore.applyOptimistic` 拡張
- [ ] `terminalMetaStore` に `fontSizeOverride` / `customTitle` 追加
- [ ] `terminalManager` に `applyOptions(id, partial)` API 追加（fit + resize 連動）
- [ ] shortcut registry に `font-zoom-in` / `font-zoom-out` / `font-zoom-reset`
- [ ] App.tsx でアクティブペインの `fontSizeOverride` を増減
- [ ] TerminalPane.tsx で settings + meta override を購読してフォント反映

### Phase 2: TerminalSettings タブ

- [ ] SettingsModal にタブ「ターミナル」追加
- [ ] フォントサイズ / フォントファミリー / 行間 UI
- [ ] カーソルスタイル / blink UI
- [ ] スクロールバック / Bell / 単語区切り UI
- [ ] デフォルトシェル / デフォルト CWD UI
- [ ] terminalManager / TerminalPane に各設定を反映
- [ ] pty-manager に shell / cwd 引数を渡す IPC 拡張

### Phase 3: EditorSettings タブ + MD エディタ反映

- [ ] SettingsModal にタブ「エディタ」追加
- [ ] フォントサイズ / フォントファミリー / 折り返し UI
- [ ] MarkdownEditor.tsx で設定を反映

### Phase 4: GeneralSettings タブ + ペインタイトル + 通知

- [ ] SettingsModal にタブ「一般」追加
- [ ] セッション復元 ON/OFF
- [ ] PTY 終了通知
- [ ] TerminalSubHeader にペインタイトル inline edit
- [ ] main 側で notification を投げる（PTY 終了時）

### Phase 5: 検証 + ドキュメント

- [ ] テスト追加 / 既存テスト調整
- [ ] CLAUDE.md §8 に T2-10 として記載
- [ ] requirements ドキュメント更新

## Files

| File                                                    | Operation | Notes                          |
| ------------------------------------------------------- | --------- | ------------------------------ |
| `src/shared/settings.ts`                                | Edit      | Schema 拡張                    |
| `src/renderer/stores/settingsStore.ts`                  | Edit      | applyOptimistic 拡張           |
| `src/renderer/stores/terminalMetaStore.ts`              | Edit      | fontSizeOverride / customTitle |
| `src/renderer/services/terminalManager.ts`              | Edit      | applyOptions API               |
| `src/renderer/components/TerminalPane.tsx`              | Edit      | settings 購読                  |
| `src/renderer/components/MarkdownEditor.tsx`            | Edit      | editor 設定反映                |
| `src/renderer/components/SettingsModal.tsx`             | Edit      | タブ追加                       |
| `src/renderer/components/settings/TerminalSettings.tsx` | Create    | 新規                           |
| `src/renderer/components/settings/EditorSettings.tsx`   | Create    | 新規                           |
| `src/renderer/components/settings/GeneralSettings.tsx`  | Create    | 新規                           |
| `src/renderer/shortcuts/registry.ts`                    | Edit      | font-zoom-\* 追加              |
| `src/renderer/App.tsx`                                  | Edit      | font-zoom handlers             |
| `src/main/pty-manager.ts`                               | Edit      | shell / cwd 引数追加           |
| `src/main/ipc-handlers.ts`                              | Edit      | pty:create シグネチャ拡張      |
| `src/preload/index.ts`                                  | Edit      | 同上                           |
| `src/renderer/components/TerminalSubHeader.tsx`         | Edit      | ペインタイトル rename          |
| `src/renderer/services/sessionRestore.ts`               | Edit      | restore ON/OFF 反映            |
| `.claude/CLAUDE.md`                                     | Edit      | T2-10 追記                     |

## Verification

- [ ] `npm test` 全部通る
- [ ] `npm run build` エラーなし
- [ ] 手動: Cmd+= / Cmd+- / Cmd+0 でアクティブペインのみフォントが変わる
- [ ] 手動: 設定画面のフォントサイズ変更が即時反映
- [ ] 手動: 別ペイン分割後も新ペインはグローバル設定が反映される
- [ ] 手動: アプリ再起動後に設定が永続化されている
- [ ] 手動: カーソル / Bell / 単語区切り / シェルが反映される
- [ ] 手動: ペインタイトル rename がサブヘッダに反映
