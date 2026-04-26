---
Status: COMPLETED
Created: 2026-04-26
Completed: 2026-04-26
Task: T2-8 Markdown Editor in Pane
Project: /Users/newlife/dev/apps/terminal-division
---

# Plan: Markdown Editor in Pane (CodeMirror 6)

## Context

### 動機

サイドバーから `.md` / `.markdown` ファイルを開いて編集できるようにする。ターミナル作業の合間にメモ・README・ドキュメントを編集する典型ワークフローを 1 アプリで完結させる。

### スコープと方針

- **ペイン拡張ではなく per-pane view mode**: レイアウト型 (`TerminalPane`) は変更せず、`terminalMetaStore` に MD 状態を持たせる。CLI と MD は同じ leaf の 2 ビュー。PTY は MD 表示中も生存
- **対象拡張子**: `.md` / `.markdown` のみ。コンテキストメニューの「編集する」項目をこの拡張子のときだけ表示するため、非対応ファイル用のモーダルは不要
- **エディタ**: CodeMirror 6（`@uiw/react-codemirror` + `@codemirror/lang-markdown` + `@codemirror/commands`）
- **トリガ**: サイドバーで `.md` を**右クリック → コンテキストメニューの「編集する」**を選択 → 確認モーダル（直近フォーカスペインの番号を提示）→ 「はい」で MD タブが開く
- **保存**: Cmd+S 明示保存 / Cmd+Z / Cmd+Shift+Z で Undo/Redo（MD pane focus 時のみ）
- **未保存警告**: タブ切替・別ファイルオープン・**ペイン close (Cmd+W)** 時にモーダル（誤操作防止）

### Non-Goals

- Markdown プレビュー（Phase 2 以降）
- 画像インライン表示 / リンク遷移 / アウトライン / Mermaid / 数式
- マルチファイル同時編集の差分表示
- 外部変更検知（`fs:watch` 連携）— 初版は手動再読込のみ

### 制約

- 既存の App.tsx capture-phase keydown が Cmd+Z / Cmd+S 等を奪うため、**MD pane focus 中はそれらをスキップ**する分岐が必要
- Renderer から fs アクセスは IPC 経由のみ（`contextIsolation: true`）
- 既存 `validatePath()` の対象範囲に新規 read/write IPC を追加

---

## Steps

### Phase 1: 基盤 (IPC + Store)

- [ ] **1. 依存追加**: `@uiw/react-codemirror` / `@codemirror/lang-markdown` / `@codemirror/commands` / `@codemirror/state` / `@codemirror/view` を `package.json` に追加し `npm install`
- [ ] **2. IPC: ファイル読み書き追加**
  - main `ipc-handlers.ts`: `fs:readFile` / `fs:writeFile` ハンドラ追加（`validatePath` で安全範囲確認、`utf-8` 固定、ファイルサイズ上限 5MB）
  - preload `index.ts` + `index.d.ts`: `window.api.fs.readFile(path)` / `writeFile(path, content)` 公開
- [ ] **3. terminalMetaStore 拡張**
  - `TerminalMeta` に `viewMode: "cli" | "md"`, `mdFilePath: string | null`, `mdSavedContent: string | null`, `mdDirty: boolean` を追加
  - actions: `openMarkdown(id, path, content)`, `setViewMode(id, mode)`, `setMdDirty(id, dirty)`, `clearMarkdown(id)`, `markMdSaved(id, content)`
  - `initMeta` / `initLeafMeta` で `viewMode: "cli"` をデフォルト設定
  - セッション永続化対象から MD 状態は**除外**（再起動時は CLI に戻る）
- [ ] **4. ファイル拡張子判定ユーティリティ**
  - `src/renderer/utils/markdownFile.ts`: `isMarkdownPath(path: string): boolean`（`.md` / `.markdown`、case-insensitive）

### Phase 2: モーダル UI

- [ ] **5. 確認モーダル `OpenMarkdownModal.tsx`**
  - props: `targetPaneNumber`, `onConfirm`, `onCancel`
  - 文言: 「ペイン **<番号>** で編集します。よろしいですか？」+ [はい / キャンセル]
  - ペイン番号を大きめのアクセントカラーで強調表示（番号確認が主目的）
  - ファイル名は補足表示（小さめ・グレー）
  - ShortcutsModal の overlay パターンを踏襲、Esc / 背景クリックでキャンセル
- [ ] **6. 未保存警告モーダル `UnsavedChangesModal.tsx`**
  - props: `filename`, `reason: "switch-to-cli" | "open-other" | "close-pane"`, `onSave`, `onDiscard`, `onCancel`
  - 文言: 「`<filename>` に未保存の変更があります。」
  - reason により補足文言: close-pane なら「このペインを閉じると変更が失われます」
  - ボタン: [保存して続行 / 破棄して続行 / キャンセル]
  - default focus は「キャンセル」（誤操作で破棄しないため）
  - これらをまとめる Modal Provider は作らない（個別に App.tsx の state で管理）

### Phase 3: コンテキストメニュー連携

- [ ] **7. DirectoryTree の `buildMenuItems` に「編集する」項目追加**
  - `isMarkdownPath(node.path)` が true のときだけ表示
  - 既存の「VSCode で開く」の直後・「名称変更」の直前に配置（`separatorBefore: true` で区切る）
  - クリック時: App から渡された `onRequestEditMarkdown(node.path)` コールバックを呼ぶ
  - `DirectoryTreeProps` に `onRequestEditMarkdown?: (path: string) => void` を追加
- [ ] **8. Sidebar → App 連携**
  - `Sidebar.tsx`: `onRequestEditMarkdown` props を受け取り `DirectoryTree` に伝搬
  - `App.tsx`: `handleRequestEditMarkdown(filePath)` 実装
    - `terminalStore.activeTerminalId` を取得（null なら rootId を fallback として暗黙対象）
    - レイアウト葉から該当ペインの番号（左→右の DFS 順、`TerminalSubHeader` と同じ計算方法）を取得
    - 既に MD 編集中（dirty）なら `UnsavedChangesModal` (reason="open-other") を先に表示
    - クリア後 `OpenMarkdownModal` 表示 → 「はい」で `fs:readFile` → `openMarkdown(id, path, content)` + `setViewMode(id, "md")`

### Phase 4: ペイン UI 切替

- [ ] **10. `MarkdownEditor.tsx` 新規作成**
  - props: `id` (paneId), `filePath`, `initialContent`
  - `@uiw/react-codemirror` を使用、`extensions: [markdown(), history(), historyKeymap, defaultKeymap]`
  - 内部で content state を持ち、変更時に `setMdDirty(id, true)` を呼ぶ
  - Cmd+S を `EditorView` の keymap で捕捉して保存（`fs:writeFile` 経由）
  - 保存成功時 `markMdSaved(id, content)` で dirty クリア
  - 保存失敗時はトースト表示（既存 `ErrorToast` 流用）
  - `onFocus` で `setActiveTerminal(id)` + `setMdPaneFocused(true)`（次ステップ参照）
- [ ] **11. `TerminalPane.tsx` の表示分岐**
  - `viewMode === "md"` のときは MarkdownEditor を表示し、xterm.js のコンテナは `display: none` で**隠すだけ**（unmount しない → PTY とバッファ生存）
  - `viewMode === "cli"` のときは従来通り
- [ ] **12. `TerminalSubHeader.tsx` にタブ UI 追加**
  - `mdFilePath` が設定されている pane のみ、左側に CLI / MD のタブ風ボタン 2 つを表示
  - 未設定時はタブを表示せず従来表示
  - タブ: `[ CLI ]` / `[ <filename>● ]`（dirty なら ● を末尾に）
  - active タブはアクセントカラーの下線
  - クリックで `setViewMode(id, "cli" | "md")`、ただし MD → CLI 切替時に dirty なら `UnsavedChangesModal` を挟む
  - MD タブ右端に `×` ボタンで `clearMarkdown(id)` → CLI 戻り（dirty なら警告）

### Phase 5: ショートカット統合

- [ ] **13. App.tsx の capture-phase keydown 修正**
  - active pane の `viewMode === "md"` のとき、Cmd+S / Cmd+Z / Cmd+Shift+Z を bypass（CodeMirror に委譲）
  - その他の既存ショートカット（分割・フォーカス移動など）はそのまま動作させる
- [ ] **14. Cmd+S グローバル委譲**
  - MD pane focus 時の Cmd+S は CodeMirror keymap で処理（前ステップで保証）
  - CLI pane focus 時の Cmd+S は従来通り（既存挙動を変更しない）

### Phase 6: 仕上げ

- [ ] **14. ペイン close (Cmd+W) ガード**
  - `App.tsx` の Cmd+W ハンドラで、対象ペインの `viewMode === "md"` かつ `mdDirty === true` のとき `UnsavedChangesModal` (reason="close-pane") を表示
  - 「保存して続行」: 保存成功後にペイン close
  - 「破棄して続行」: そのまま close、メタは `removeMeta` で削除
  - 「キャンセル」: 何もしない
  - dirty でない MD ペインは確認なしで close（CLI と同等扱い）
  - `closeTerminal()` 自体には警告ロジックを入れない（呼び出し側責任）
- [ ] **15. 動作確認**: 開発サーバで一連のフロー（右クリック → 編集する → 確認モーダル → 編集 → 保存 → CLI 切替 → 戻る → 別 .md 開く → 未保存警告 → Cmd+W で close 警告）を手動確認
- [ ] **16. ドキュメント更新**
  - `.claude/CLAUDE.md` の Tier 2 に `T2-8: Markdown Editor in Pane` 追記
  - `.claude/docs/requirements/tier-2-supporting.md` に詳細追記
  - 必要なら `code-explanation/` に章追加（任意）

---

## Files

| File                                                | Operation                  | Notes                                                                        |
| --------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `package.json`                                      | Update                     | CodeMirror 6 系依存 5 件追加                                                 |
| `src/main/ipc-handlers.ts`                          | Update                     | `fs:readFile` / `fs:writeFile` ハンドラ追加                                  |
| `src/preload/index.ts`                              | Update                     | `window.api.fs.readFile/writeFile` 公開                                      |
| `src/preload/index.d.ts`                            | Update                     | 型追加                                                                       |
| `src/renderer/stores/terminalMetaStore.ts`          | Update                     | viewMode + MD 関連フィールド + actions 追加                                  |
| `src/renderer/utils/markdownFile.ts`                | Create                     | `isMarkdownPath`                                                             |
| `src/renderer/components/MarkdownEditor.tsx`        | Create                     | CodeMirror 6 ラッパ                                                          |
| `src/renderer/components/OpenMarkdownModal.tsx`     | Create                     | ペイン番号確認モーダル                                                       |
| `src/renderer/components/UnsavedChangesModal.tsx`   | Create                     | 未保存警告モーダル（switch / open-other / close-pane の 3 用途）             |
| `src/renderer/components/TerminalPane.tsx`          | Update                     | viewMode 分岐、MD 表示時は xterm 非表示                                      |
| `src/renderer/components/TerminalSubHeader.tsx`     | Update                     | タブ UI 追加                                                                 |
| `src/renderer/components/Sidebar/DirectoryTree.tsx` | Update                     | `buildMenuItems` に「編集する」追加、`onRequestEditMarkdown` props 受け取り  |
| `src/renderer/components/Sidebar/Sidebar.tsx`       | Update                     | `onRequestEditMarkdown` props 伝搬                                           |
| `src/renderer/App.tsx`                              | Update                     | モーダル state 管理、handleRequestEditMarkdown、Cmd+W ガード、keydown bypass |
| `src/main/types/session-state.ts`                   | (確認のみ)                 | MD 状態を永続化対象に含めない（コードで除外）                                |
| `.claude/CLAUDE.md`                                 | Update                     | Tier 2 に T2-8 追加                                                          |
| `.claude/docs/requirements/tier-2-supporting.md`    | Update                     | 詳細追記                                                                     |
| `.claude/MEMORY.md`                                 | Update (task-tracker 経由) | 進行中タスク登録                                                             |
| `.claude/HISTORY.md`                                | Update (task-tracker 経由) | セッション履歴                                                               |

---

## Verification

- [ ] **V1**: 単一ペインで `.md` を開いて編集 → Cmd+S 保存 → タブの ● が消える
- [ ] **V2**: 編集中に Cmd+Z で undo / Cmd+Shift+Z で redo が動く
- [ ] **V3**: タブで CLI に切替 → CLI バッファ・カーソル位置・スクロール位置が保たれている
- [ ] **V4**: タブで MD に戻す → 編集内容が保たれている
- [ ] **V5**: dirty 状態で CLI タブクリック → 未保存警告モーダル表示。「保存」「破棄」「キャンセル」がそれぞれ機能
- [ ] **V6**: dirty 状態で別 `.md` の右クリック → 「編集する」→ 警告モーダル表示
- [ ] **V7**: `.txt` を右クリック → コンテキストメニューに「編集する」項目が**表示されない**
- [ ] **V8**: dirty 状態で Cmd+W → 未保存警告モーダル表示。dirty でない MD ペインは確認なしで close
- [ ] **V8b**: ペイン close 時に MD 状態がメタごとクリーンアップされる
- [ ] **V9**: 4 ペイン分割した状態で 1 つを MD にし、Cmd+Option+Arrow でフォーカス移動 → 既存ショートカット動作
- [ ] **V10**: MD pane focus 中に Cmd+S → 保存（CLI 側へリークしない）
- [ ] **V11**: アプリ再起動 → MD は CLI に戻る（永続化されない）が、レイアウトと CWD は保持される
- [ ] **V12**: 5MB 超のファイルを開こうとすると拒否される
- [ ] **V13**: 日本語入力 / IME 変換が CodeMirror 上で正常動作（ターミナル側 IME ハンドラと干渉しない）
- [ ] **V14**: `npm test` パス
- [ ] **V15**: `npm run build` パス
- [ ] **V16**: パッケージ版（`npx electron-builder --mac --dir`）でも開く・保存できる

---

## Open Questions（実装中に判断）

1. **dirty 判定**: 「最後に保存した内容との差分」で判定（空文字 → 何か入力 → 全削除でも dirty=false に戻る）。CodeMirror の `EditorState.doc.toString() === mdSavedContent` で比較
2. **ペイン番号の算出**: 既存 `TerminalSubHeader` で使われている paneNumber は `SplitContainer` の DFS 順から渡されている。`OpenMarkdownModal` でも同じ番号を表示するため、活性ペイン id → 番号の解決ロジックを共通化（`layoutUtils.ts` に `getPaneNumber(rootId, nodes, paneId)` を追加）
3. **「編集する」を非 .md でも常に表示し disabled にする** vs **そもそも表示しない** → **表示しない方針**（コンテキストメニュー肥大化を防ぎ、対応ファイルだけ自然に「開ける」と認知させる）
