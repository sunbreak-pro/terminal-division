---
Status: PLANNED
Created: 2026-04-26
Task: T2-9 Settings (Theme / Shortcuts / Opacity)
Project: /Users/newlife/dev/apps/terminal-division
---

# Plan: Settings Feature (Theme / Shortcuts / Opacity)

## Context

### 動機

現状はテーマ切替が固定 4 種、ショートカットはハードコード、ウィンドウは不透明のみ。ユーザーの作業環境差・好みに合わせた高いカスタマイズ性を提供することで、iTerm2 / Warp / Ghostty と同等の「自分仕様のターミナル」体験を実現する。Settings UI 自体が「Terminal Division の作り込み度」のショーケースにもなる。

### スコープと方針

- **モーダル方式**で実装（既存 `ShortcutsModal` のパターンを踏襲）
- MVP は **3 領域すべて**: テーマカラー / ショートカットキー / Window Opacity
- `.itermcolors`（XML plist）インポートも MVP に含める（`mbadolato/iTerm2-Color-Schemes` の 450+ プリセット流用が目的）
- **設計モデル**: VS Code / Zed の "GUI first + JSON SSOT" 二層。`userData/settings.json` を Single Source of Truth にし、GUI はその編集 UI として機能
- **テーマシステム拡張**: 既存 4 プリセット + カスタムテーマ複数保持。xterm.js `ITheme` の全プロパティ（30 弱）を編集対象に
- **ショートカット**: 既存ハードコードを `shortcutRegistry.ts` に集約 → ID ベースで再割り当て。capture-phase keydown は維持
- **Opacity**: Electron `vibrancy: 'under-window'` + `transparent: true` をオプトインで有効化。デフォルト Off（Electron #31862 対策）

### Non-Goals

- フォント / 行間 / カーソル形状などの追加カスタマイズ（Phase 2 以降に分離）
- 設定のクラウド同期 / プロファイル機能（Non-Goal、CLAUDE.md §1）
- ベル動作・ブラケットペースト挙動の設定化（Phase 2 以降）
- ショートカットの `when` 節（コンテキスト条件）— MVP は global のみ
- 設定の Workspace 階層（VS Code 的な user/workspace 分離）— ウィンドウ単位のオーバーライドはしない
- Windows / Linux での vibrancy 対応（macOS 一級主義に従う）

### 制約

- xterm.js `ITheme` 適用は既存 `terminalManager.updateAllThemes()` 経由のみ（直接 `terminal.options.theme = ...` は NG）
- 設定変更は **ウィンドウごとに即時反映**、複数ウィンドウ間の同期はしない（既存の "make each window's theme independent" コミット f4b75aa 直前 a155d11 の方針を踏襲）
- ただし `settings.json` の永続化は全ウィンドウ共通（次回起動時に最後に保存された設定を読む）
- Renderer から fs / window 制御は IPC 経由のみ（`contextIsolation: true`）
- ショートカット実行ロジックを大幅リファクタしない（`App.tsx:194-450` の switch を ID ディスパッチに置き換える程度に留める）
- vibrancy 切替は **再起動が必要** な場合がある（Electron 33 の制約）。UI で明示する

---

## Steps

### Phase 1: 設定基盤 (Settings Store / 永続化 / IPC)

- [ ] **1. 依存追加**
  - `react-colorful`（カラーピッカー、軽量 ~2.8kB）
  - `package.json` に追加 → `npm install`
- [ ] **2. 設定スキーマ定義 `src/shared/settings.ts`**（main / renderer 両方から import）
  - `AppSettings`:
    ```ts
    interface AppSettings {
      version: 1;
      theme: {
        currentThemeId: string;
        customThemes: Theme[]; // ユーザー定義テーマ（既存 Theme 型を再利用）
      };
      shortcuts: Record<ShortcutId, string | null>; // null = 無効化
      window: {
        opacity: number; // 0.5 - 1.0
        vibrancyEnabled: boolean; // false がデフォルト
      };
    }
    ```
  - `DEFAULT_SETTINGS` 定数も同ファイルに定義
- [ ] **3. SettingsManager (main) `src/main/settings.ts`**
  - `RecentDirectoryManager` パターン踏襲: `app.getPath("userData")/settings.json`
  - `load() / save() / get() / update(partial)` メソッド
  - `update()` は debounce 250ms でファイル書込（`SessionStateManager` パターン）
  - 起動時 load 失敗 / バリデーション失敗 → `DEFAULT_SETTINGS` で復旧（サイレントフォールバック）
- [ ] **4. IPC ハンドラ追加 `src/main/ipc-handlers.ts`**
  - `settings:get` → `AppSettings`
  - `settings:update` → partial AppSettings を受けてマージ保存
  - `settings:importItermColors` → ファイルパスを受けて XML plist パース → `Theme` 返却（plist パースは `plist` パッケージか自前実装、サイズ上限 1MB）
  - `window:setOpacity` → `BrowserWindow.setOpacity(value)`（即時反映、再起動不要）
  - `window:setVibrancy` → 再起動が必要な旨を返す（実装は次回起動時の `createWindow` で反映）
- [ ] **5. preload 公開 `src/preload/index.ts` + `index.d.ts`**
  - `window.api.settings.get() / update() / importItermColors(path)`
  - `window.api.window.setOpacity(value)`

### Phase 2: ショートカットレジストリ化

- [ ] **6. `src/renderer/shortcuts/registry.ts` 新規**
  - `ShortcutId` 型（union literal）: `"split-vertical"`, `"split-horizontal"`, `"close-pane"`, `"focus-up"`, `"focus-down"`, `"focus-left"`, `"focus-right"`, `"open-find"`, `"undo"`, `"redo"`, `"reload"`, `"open-file"`, `"toggle-sidebar"`, `"open-settings"` など（既存 App.tsx から抽出、20 個前後）
  - `ShortcutDefinition`: `{ id, label, defaultKey, category }`
  - `SHORTCUT_DEFINITIONS: ShortcutDefinition[]`（ShortcutsModal の `shortcutCategories` を移植）
  - `parseKey(eventLike): string`（`KeyboardEvent` を `"Cmd+Shift+D"` 形式に正規化）
  - `matchKey(event, shortcutKey): boolean`
- [ ] **7. App.tsx の keydown 分岐を ID ベースに置換**
  - `handleKeyDown` 内で `parseKey(event)` → settings の `shortcuts` マップで逆引き → ID で switch
  - 既存の動作は完全維持（リグレッション禁止）
  - settings 未読込時はデフォルトキーで動作
- [ ] **8. ShortcutsModal の表示も registry から生成**
  - `shortcutCategories` ハードコードを撤去し `SHORTCUT_DEFINITIONS` から動的構築
  - 現在のキー（settings 反映済み）を表示

### Phase 3: Settings Store (Renderer)

- [ ] **9. `src/renderer/stores/settingsStore.ts` 新規**
  - Zustand store: `settings: AppSettings`, `isLoaded: boolean`
  - `load()` → IPC `settings:get` で main から取得
  - `update(partial)` → store 更新 + IPC `settings:update`（双方向同期）
  - 起動時 `App.tsx` で `useEffect(() => { useSettingsStore.getState().load() }, [])`
- [ ] **10. themeStore を settings 連動に**
  - `availableThemes` を「組込 4 プリセット + `settings.theme.customThemes`」に変更
  - `setTheme(id)` で `settingsStore.update({ theme: { currentThemeId: id } })` を呼ぶ
  - `addCustomTheme(theme) / updateCustomTheme(theme) / deleteCustomTheme(id)` 追加（settings 経由で永続化）

### Phase 4: SettingsModal UI

- [ ] **11. `src/renderer/components/SettingsModal.tsx` 新規**
  - レイアウト: 左サイドバー（カテゴリリスト）+ 右ペイン（カテゴリ内容）
  - カテゴリ: `["外観", "ショートカット", "ウィンドウ"]`
  - `ShortcutsModal` の overlay / ESC / 背景クリック / z-index:1000 を踏襲
  - 横幅 800px / 高さ 600px 固定（モーダル内スクロール）
  - Header.tsx に「歯車アイコン」ボタン追加 → モーダル開閉
  - キーボードショートカット `Cmd+,` で開く（ShortcutDefinition `"open-settings"` として登録）

- [ ] **12. 「外観」タブ `src/renderer/components/settings/AppearanceSettings.tsx`**
  - **テーマ選択**: ドロップダウンで組込 + カスタム一覧
  - **「複製して編集」ボタン** → 現在のテーマをカスタムとして複製、編集モードへ
  - **カスタムテーマ編集領域**（カスタムテーマ選択時のみ表示）:
    - テーマ名入力
    - **基本色** (アコーディオン open default): foreground / background / cursor / cursorAccent / selectionBackground / selectionForeground
    - **ANSI 16 色** (アコーディオン): black, red, green, yellow, blue, magenta, cyan, white + bright 8 色
    - 各カラー欄は `react-colorful` ポップオーバー + HEX 入力 + プレビュースウォッチ
    - **App UI カラー**: AppColors の主要項目（headerBackground, accent, buttonHover など）
    - **「削除」ボタン**（カスタムのみ）
  - **インポート/エクスポート**:
    - 「`.itermcolors` をインポート」ボタン → ファイル選択ダイアログ → IPC `settings:importItermColors` → カスタムテーマとして追加
    - 「JSON でエクスポート」ボタン → 現在テーマの JSON をクリップボードコピー
  - **プレビュー**: 編集中のテーマをモーダル内のミニターミナル風プレビューに即時反映（実 PTY 不要、xterm.js を embed して "Hello $ ls -la" 程度の固定テキスト表示）

- [ ] **13. 「ショートカット」タブ `src/renderer/components/settings/ShortcutSettings.tsx`**
  - 表形式: `[ラベル | 現在のキー | 変更ボタン | デフォルトに戻す]`
  - **変更ボタン** → "Recording..." 状態に切替 → 次の keydown を取得して正規化キー文字列化 → settings に保存
  - 録音中は capture-phase で他のショートカット動作を抑止
  - **競合検出**: 同一キー文字列が他の ShortcutId に既存 → 警告バナー「Cmd+D は既に "縦に分割" に割り当て済み。上書きしますか？」+ [上書き / キャンセル]
  - 上書き時は他方を `null`（無効）に
  - **無効化**: 「クリア」ボタンで `null` 設定可能
  - 「すべてデフォルトに戻す」ボタン

- [ ] **14. 「ウィンドウ」タブ `src/renderer/components/settings/WindowSettings.tsx`**
  - **Opacity スライダー**: 0.5 - 1.0、step 0.01、リアルタイムで `window.api.window.setOpacity()` を呼ぶ
  - **Vibrancy トグル**: ON/OFF
    - ON にすると注意書き表示: 「ウィンドウ透過効果はアプリ再起動後に有効になります」
    - 「再起動」ボタン（Electron `app.relaunch() + app.exit()`）
  - **既知の制約注記**（小さいヘルプテキスト）: 「macOS のみ対応 / 一部環境で背景が白く表示される場合があります」

### Phase 5: Window Manager 連携

- [ ] **15. `src/main/window-manager.ts` 拡張**
  - `createWindow()` 内で起動時 `settings.get()` を呼んで `vibrancyEnabled` / `opacity` を反映
  - `vibrancyEnabled === true` のとき: `transparent: true`, `vibrancy: 'under-window'`, `backgroundColor: '#00000000'`
  - `vibrancyEnabled === false` のとき: 現状維持（`backgroundColor: '#1a1a1a'`）
  - 生成直後に `win.setOpacity(settings.window.opacity)`
- [ ] **16. 起動時の初期反映確認**
  - 全ウィンドウで設定が読み込まれること
  - vibrancy 切替後の再起動で設定が反映されること

### Phase 6: テスト & 仕上げ

- [ ] **17. ユニットテスト**
  - `parseKey()` / `matchKey()` の正規化ロジック（`Cmd+Shift+D` / 大文字小文字 / 修飾キー順序）
  - SettingsManager の load/save/validation
  - itermcolors パーサ（代表的な数件: Solarized Dark, Dracula）
- [ ] **18. 手動検証**（Verification と重複だが実装完了の確認用）
  - dev / build / package 全モードで動作確認
  - 既存ショートカット全ての動作維持
  - vibrancy オン後の起動・再起動・カスタムテーマ永続化
- [ ] **19. CLAUDE.md 更新**
  - §3.9 Settings 節を追加（永続化先、IPC、SSOT 構造）
  - §8 Tier 2 に T2-9 追記
  - `docs/requirements/tier-2-supporting.md` に詳細記入

---

## Files

| File                                                      | Operation | Notes                                                              |
| --------------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| `src/shared/settings.ts`                                  | Create    | AppSettings 型 + DEFAULT_SETTINGS                                  |
| `src/main/settings.ts`                                    | Create    | SettingsManager（load/save/debounce）                              |
| `src/main/ipc-handlers.ts`                                | Modify    | settings:get / update / importItermColors / window:setOpacity 追加 |
| `src/main/window-manager.ts`                              | Modify    | vibrancy / opacity 起動時反映                                      |
| `src/main/index.ts`                                       | Modify    | SettingsManager 初期化、ipc-handlers 登録                          |
| `src/preload/index.ts`                                    | Modify    | window.api.settings / window.setOpacity 公開                       |
| `src/preload/index.d.ts`                                  | Modify    | 型定義追加                                                         |
| `src/renderer/shortcuts/registry.ts`                      | Create    | ShortcutId / DEFINITIONS / parseKey / matchKey                     |
| `src/renderer/stores/settingsStore.ts`                    | Create    | Zustand store + IPC 同期                                           |
| `src/renderer/stores/themeStore.ts`                       | Modify    | customThemes 連動、settingsStore 連携                              |
| `src/renderer/App.tsx`                                    | Modify    | keydown を ID ディスパッチに置換、settings load                    |
| `src/renderer/components/Header.tsx`                      | Modify    | 歯車アイコン → SettingsModal トリガ                                |
| `src/renderer/components/ShortcutsModal.tsx`              | Modify    | shortcutCategories を registry から動的生成                        |
| `src/renderer/components/SettingsModal.tsx`               | Create    | モーダル本体（カテゴリタブ）                                       |
| `src/renderer/components/settings/AppearanceSettings.tsx` | Create    | テーマ編集 UI                                                      |
| `src/renderer/components/settings/ShortcutSettings.tsx`   | Create    | ショートカット再割当 UI                                            |
| `src/renderer/components/settings/WindowSettings.tsx`     | Create    | Opacity / Vibrancy UI                                              |
| `src/renderer/components/settings/ColorField.tsx`         | Create    | react-colorful + HEX 入力の共通フィールド                          |
| `src/renderer/utils/itermcolors.ts`                       | Create    | （main 側で実装する場合は不要、renderer 側で完結させるなら）       |
| `package.json`                                            | Modify    | react-colorful 追加                                                |
| `src/renderer/App.tsx` (test)                             | Test      | 既存テストにリグレッションないこと                                 |
| `src/main/settings.test.ts`                               | Create    | SettingsManager のユニットテスト                                   |
| `src/renderer/shortcuts/registry.test.ts`                 | Create    | parseKey / matchKey テスト                                         |
| `.claude/CLAUDE.md`                                       | Modify    | §3.9 Settings 節 + §8 T2-9                                         |
| `.claude/docs/requirements/tier-2-supporting.md`          | Modify    | T2-9 詳細追加                                                      |

---

## Verification

- [ ] `npm test` 全パス（既存 + 新規）
- [ ] `npm run build` 成功（型エラーなし）
- [ ] **テーマ**: 組込 4 種の切替が即時反映される
- [ ] **テーマ**: 「複製して編集」 → 色変更 → 別テーマに切替 → 戻すと編集内容が保持される
- [ ] **テーマ**: アプリ再起動後もカスタムテーマが残る
- [ ] **テーマ**: `.itermcolors`（Solarized Dark）をインポートして適用、xterm 上で色が反映される
- [ ] **テーマ**: JSON エクスポート → クリップボードに有効な JSON
- [ ] **ショートカット**: 既存全ショートカット（Cmd+D / Cmd+Shift+D / Cmd+W / Cmd+Option+矢印 / Cmd+F / Cmd+R / Cmd+O / Cmd+Z / Cmd+Shift+Z / Cmd+,）が動作
- [ ] **ショートカット**: 任意のショートカットを再割当 → 即座に新しいキーで動作 / 旧キーは無効
- [ ] **ショートカット**: 競合警告が表示され、上書き時に他方が無効化される
- [ ] **ショートカット**: 「すべてデフォルトに戻す」が機能
- [ ] **ショートカット**: 録音中は他のショートカットがトリガされない
- [ ] **Opacity**: スライダー操作で即座にウィンドウが半透明化（再起動不要）
- [ ] **Vibrancy**: ON にして再起動 → ウィンドウが半透明 + すりガラス効果
- [ ] **Vibrancy**: OFF に戻して再起動 → 不透明な背景に戻る
- [ ] **永続化**: 設定変更後にアプリ終了 → 再起動で全設定が復元
- [ ] **永続化**: `userData/settings.json` を手動で破壊 → 起動時にデフォルトで復旧（クラッシュしない）
- [ ] **IME**: ショートカット録音中の日本語入力で誤動作しない（IME ガード維持）
- [ ] **マルチウィンドウ**: 1 つのウィンドウで設定変更 → 他のウィンドウにも反映（または明示的に「再起動が必要」）
- [ ] **リグレッション**: ペイン分割 / 検索 / Markdown エディタ / セッション永続化 / Undo-Redo の全機能が従前通り動作

---

## Risks & Mitigation

| リスク                                           | 軽減策                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Electron #31862（vibrancy 白背景バグ）が再発     | デフォルト Off、UI に既知制約を明示。フォールバックとして CSS `backdrop-filter` も検討（Phase 2） |
| ショートカット ID 移行で既存動作にリグレッション | `App.tsx` の switch 全分岐を 1:1 で ID 化、各ケースに手動検証                                     |
| `.itermcolors` パーサのエッジケース（XML 不正）  | サイズ上限 + try/catch でエラー時はトースト通知                                                   |
| settings.json が破損                             | バリデーション失敗時はサイレントフォールバック（既存 SessionStateManager 同様）                   |
| カラーピッカーのバンドルサイズ膨張               | react-colorful 採用（~2.8kB）、shadcn 等の重量級は避ける                                          |
| 既存 themeStore がウィンドウ独立設計             | 設計を維持しつつ、永続化レイヤだけ共通にする（次回起動時のみ全ウィンドウに反映）                  |

---

## Implementation Order Notes

Phase 1 → 2 → 3 は依存があるため順次。Phase 4 は Phase 3 完了後に着手するが、サブタブ（Appearance / Shortcuts / Window）は並列実装可能。Phase 5 は Phase 1 の IPC があれば独立実装可。Phase 6 は最後。

各 Phase は 1 セッションで完了する想定。Phase 4 は分量が多いので 2 セッションに分けても可（Modal 骨格 + Appearance / Shortcuts + Window）。
