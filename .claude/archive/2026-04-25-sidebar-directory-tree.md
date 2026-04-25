---
Status: COMPLETED
Created: 2026-04-25
Completed: 2026-04-25
Task: MEMORY.md > 直近の完了 > 「左サイドバー実装」
Project: /Users/newlife/dev/apps/terminal-division
---

# Plan: Left sidebar with per-CWD tabs and directory tree

## Context

### 動機

ユーザーが現在開いているディレクトリ構造をターミナル外で俯瞰できる UI を提供する。複数ペイン分割時は CWD ごとに縦タブで切り替え、ファイル/ディレクトリへのコンテキストアクション（削除/移動/リネーム/cd/VSCode で開く）も可能にする。

### 制約

- 既存ペイン分割（`SplitContainer` 配下の `react-resizable-panels`）の動作を壊さない
- ペインごとの CWD は既に `terminalMetaStore` に OSC 7 経由で流れている → これを再利用する
- セキュリティ: Renderer から直接 fs にアクセスせず、すべて IPC 経由
- パフォーマンス: `node_modules` も除外しない要件のため、watch は **展開済みノードのみ**

### Non-Goals（今回スコープ外）

- 右クリックメニューの一部高度操作（複数選択/D&D/検索）
- Git ステータスバッジ
- ファイル検索
- 開閉状態・展開状態・選択中タブの永続化（要件 14: 幅のみ）

### 確定した UX

| 操作                   | 対象                  | 挙動                                                           |
| ---------------------- | --------------------- | -------------------------------------------------------------- |
| シングルクリック       | ディレクトリ          | 展開/折りたたみトグル + 選択                                   |
| シングルクリック       | ファイル              | 選択ハイライトのみ                                             |
| ダブルクリック         | ディレクトリ          | 展開/折りたたみのみ（メニューは出さない）                      |
| ダブルクリック         | ファイル              | コンテキストメニュー表示（削除/移動/名称変更/VSCode）          |
| 右クリック             | ファイル/ディレクトリ | 同上のコンテキストメニュー（OS 標準 UX 維持）                  |
| 右クリック             | タブ                  | 相対パス/フルパスをコピー                                      |
| 名称変更               | -                     | ツリー内インライン編集（input → Enter 確定/Esc 取消）          |
| 削除                   | -                     | `shell.trashItem`（macOS ゴミ箱）                              |
| 移動                   | -                     | `dialog.showOpenDialog`（ディレクトリ選択）                    |
| そのディレクトリに移動 | フォルダのみ          | アクティブターミナルに `cd '<path>'\n` 送信                    |
| VSCode で開く          | -                     | `code <path>` をシェル経由で実行（CLI 不在ならエラートースト） |

### タブ仕様

- 同じ CWD のペインは 1 タブに集約
- タブクリック → 集約ペイン群のうち **直近アクティブだったペイン** をアクティブ化
- 並び順: ペイン作成順（タブ初出時刻）
- ラベル衝突: 同じ basename が他タブと衝突したら **全衝突タブを `name (parent)` 形式に書き換え**、tooltip でフルパス
- ペインを閉じたとき: そのペインが唯一そのタブを参照していたらタブ削除、複数なら残す
- タブクローズボタン: なし

### 永続化

- サイドバー幅のみ JSON 永続化（`recent-directories.json` と同じパターン）
- 開閉状態/展開状態/選択タブ: セッション内のみ（再起動でリセット、デフォルト=開いた状態）

---

## Steps

### Phase 1: IPC + chokidar 基盤

- [ ] 1. `chokidar` を `package.json` の dependencies に追加し `npm install`
- [ ] 2. `src/main/file-system-handler.ts` を新規作成（readDir / watch / unwatch / rename / move / trash / openInVSCode）
- [ ] 3. `src/main/sidebar-state.ts` を新規作成（幅永続化、`recent-directories.ts` パターン）
- [ ] 4. `src/main/ipc-handlers.ts` に新ハンドラ登録（`fs:*`, `sidebar:*`）
- [ ] 5. `src/preload/index.ts` に `window.api.fs.*` と `window.api.sidebar.*` を公開
- [ ] 6. `electron.vite.config.ts` の main の rollup external に `chokidar` を追加（native fs.watch 依存対策）

### Phase 2: ストアと集約ロジック

- [ ] 7. `src/renderer/stores/sidebarStore.ts` を新規作成（isOpen / width / expandedPaths / selectedTabCwd / actions）
- [ ] 8. `src/renderer/stores/fileTreeStore.ts` を新規作成（path → children キャッシュ、watch 参照カウント、エラー状態）
- [ ] 9. `src/renderer/stores/terminalMetaStore.ts` を編集（`lastActiveAt` フィールド追加、`touchActive(id)` action 追加）
- [ ] 10. `src/renderer/utils/labelCollision.ts` を新規作成（basename 衝突解決ロジック）
- [ ] 11. `src/renderer/utils/labelCollision.test.ts` を新規作成（ユニットテスト: 衝突なし / 2 衝突 / 3 衝突 / 異なる親で同名）

### Phase 3: UI コンポーネント

- [ ] 12. `src/renderer/components/Sidebar/Sidebar.tsx` を新規作成（コンテナ、リサイズハンドル統合）
- [ ] 13. `src/renderer/components/Sidebar/SidebarTabs.tsx` を新規作成（縦スタックタブ、衝突解決適用、tooltip）
- [ ] 14. `src/renderer/components/Sidebar/DirectoryTree.tsx` を新規作成（ルートからの再帰レンダリング、空状態）
- [ ] 15. `src/renderer/components/Sidebar/TreeNode.tsx` を新規作成（lazy 展開、アイコン、シングル/ダブルクリック分岐、インライン編集モード）
- [ ] 16. `src/renderer/components/Sidebar/ResizeHandle.tsx` を新規作成（ドラッグでサイドバー幅変更、min/max クランプ）
- [ ] 17. `src/renderer/components/Header.tsx` にサイドバートグルアイコンを追加（タイトル右隣、`PanelLeft`/`PanelLeftClose` SVG）
- [ ] 18. `src/renderer/App.tsx` のレイアウトを編集（Header の下を flex row に：Sidebar + 既存 SplitContainer ラッパー）

### Phase 4: コンテキストメニューとファイル操作

- [ ] 19. `src/renderer/components/Sidebar/ContextMenu.tsx` を新規作成（汎用ネイティブ風メニュー、外側クリックで閉じる、Esc で閉じる）
- [ ] 20. `src/renderer/components/Sidebar/FileContextMenu.tsx` を新規作成（5 アクション、ディレクトリ時のみ「そのディレクトリに移動」表示）
- [ ] 21. `src/renderer/components/Sidebar/TabContextMenu.tsx` を新規作成（相対パス/フルパスコピー）
- [ ] 22. `src/renderer/components/Sidebar/ErrorToast.tsx` を新規作成（VSCode CLI 不在等の通知用、auto-dismiss 4s）
- [ ] 23. インラインリネームを TreeNode.tsx に統合（編集中状態を fileTreeStore で管理）

### Phase 5: 連動と購読

- [ ] 24. アクティブペイン変更 → 選択タブ追従の effect を Sidebar.tsx に実装
- [ ] 25. タブクリック → 直近アクティブペインに `setActiveTerminal` のロジックを SidebarTabs に実装
- [ ] 26. ペイン focus 時に `terminalMetaStore.touchActive(id)` を呼ぶ（`TerminalPane.tsx` の `onFocus` を編集）
- [ ] 27. ペインクローズで参照ゼロのタブが消えるよう selector で派生（明示的な削除アクション不要）
- [ ] 28. 展開状態に応じた watch / unwatch を Sidebar.tsx で発行（参照カウント `fileTreeStore`）
- [ ] 29. `fs:change` リスナーを TreeNode.tsx で購読し、対応パスのキャッシュを invalidate して再 readDir

### Phase 6: 検証

- [ ] 30. `npm test` 通過（labelCollision ユニットテスト、新規 Sidebar 周辺テストは最小限）
- [ ] 31. `npm run build` 通過（型 OK、Vite ビルド OK）
- [ ] 32. `npm run dev` で手動スモーク：
  - サイドバー開閉トグル
  - 単一ペイン → 1 タブ表示
  - 横分割 → CWD 同じなら 1 タブ集約 / `cd` で別 CWD なら新タブ
  - basename 衝突時にタブが `name (parent)` になる
  - ツリー lazy 展開 + 折りたたみで watch 解除
  - ファイル右クリック / ダブルクリック → メニュー表示
  - 削除（ゴミ箱に入る）/ 名称変更 / 移動 / cd / VSCode 起動
  - リサイズハンドルで幅変更 → 再起動後復元
- [ ] 33. CLAUDE.md / MEMORY.md / HISTORY.md を更新し、本プランを `archive/` へ移動（Status=COMPLETED）

---

## Files

| File                                                  | Operation        | Notes                                                                            |
| ----------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| `package.json`                                        | 編集             | `chokidar` 追加（^3.5.3 想定）                                                   |
| `electron.vite.config.ts`                             | 編集             | main rollup external に `chokidar` 追加                                          |
| `src/main/file-system-handler.ts`                     | 新規             | readDir / watch / unwatch / rename / moveToDir / trash / openInVSCode + chokidar |
| `src/main/sidebar-state.ts`                           | 新規             | サイドバー幅の JSON 永続化（singleton + load/save）                              |
| `src/main/ipc-handlers.ts`                            | 編集             | `fs:*` / `sidebar:*` ハンドラ登録、`before-quit` で watcher クリーンアップ       |
| `src/main/index.ts`                                   | 編集（必要なら） | 起動時の初期化（fs handler は ipc-handlers から呼ぶので不要かも）                |
| `src/preload/index.ts`                                | 編集             | `window.api.fs` / `window.api.sidebar` 追加                                      |
| `src/renderer/stores/sidebarStore.ts`                 | 新規             | open / width / expandedPaths / selectedTabCwd                                    |
| `src/renderer/stores/fileTreeStore.ts`                | 新規             | パス → 子ノード Map、watch 参照カウント、編集中ノード ID                         |
| `src/renderer/stores/terminalMetaStore.ts`            | 編集             | `lastActiveAt` フィールド + `touchActive` action                                 |
| `src/renderer/utils/labelCollision.ts`                | 新規             | basename 衝突解決                                                                |
| `src/renderer/utils/labelCollision.test.ts`           | 新規             | ユニットテスト                                                                   |
| `src/renderer/components/Sidebar/Sidebar.tsx`         | 新規             | コンテナ、リサイズ統合、watch 管理 effect                                        |
| `src/renderer/components/Sidebar/SidebarTabs.tsx`     | 新規             | 縦スタックタブ                                                                   |
| `src/renderer/components/Sidebar/DirectoryTree.tsx`   | 新規             | ルート再帰                                                                       |
| `src/renderer/components/Sidebar/TreeNode.tsx`        | 新規             | 1 ノード（lazy 展開、リネーム、シングル/ダブル分岐）                             |
| `src/renderer/components/Sidebar/ResizeHandle.tsx`    | 新規             | ドラッグハンドル                                                                 |
| `src/renderer/components/Sidebar/ContextMenu.tsx`     | 新規             | 汎用ポータルメニュー                                                             |
| `src/renderer/components/Sidebar/FileContextMenu.tsx` | 新規             | ファイル/ディレクトリ用                                                          |
| `src/renderer/components/Sidebar/TabContextMenu.tsx`  | 新規             | タブ用（パスコピー）                                                             |
| `src/renderer/components/Sidebar/ErrorToast.tsx`      | 新規             | エラー通知（VSCode CLI なし等）                                                  |
| `src/renderer/components/Header.tsx`                  | 編集             | サイドバートグルアイコン追加                                                     |
| `src/renderer/components/TerminalPane.tsx`            | 編集             | focus 時に `touchActive` 呼出し                                                  |
| `src/renderer/App.tsx`                                | 編集             | レイアウトを Sidebar + Main の flex row に                                       |
| `.claude/MEMORY.md`                                   | 編集             | タスク登録                                                                       |
| `.claude/HISTORY.md`                                  | 編集             | セッション履歴                                                                   |
| `.claude/CLAUDE.md`                                   | 編集             | Architecture（§3）/ Feature Tier Map（§8 T1-5 として追加）に反映                 |

---

## Verification

- [ ] `npm test` 全 PASS（既存 + 新規 labelCollision）
- [ ] `npm run build` がエラーなく完了
- [ ] dev 起動でサイドバートグルが Header の Title 右隣に表示され、クリックで開閉
- [ ] サイドバー幅をドラッグで変更し、アプリ再起動後も同じ幅で起動
- [ ] 単一ペイン状態で CWD が 1 タブとして表示される
- [ ] 横分割後、両ペインが同じ CWD なら 1 タブ、片方で `cd` すると 2 タブに分岐
- [ ] 同名 basename CWD（例: `~/a/foo` と `~/b/foo`）が両方タブに出ているとき、両方とも `foo (a)` / `foo (b)` 表示になる
- [ ] ファイル右クリック → 5 項目（フォルダのみ「そのディレクトリに移動」が増える）
- [ ] ダブルクリックでもファイルメニューが出る、ディレクトリは展開のみ
- [ ] 削除がゴミ箱に入る（完全消滅していない）
- [ ] 名称変更がインライン入力でき、Enter で確定、Esc でキャンセル
- [ ] 移動先選択ダイアログでパスが移動する
- [ ] 「そのディレクトリに移動」でアクティブターミナルに `cd '<path>'\n` が送信される
- [ ] VSCode CLI が PATH にあれば起動、なければエラートーストが出る
- [ ] アクティブペイン切替で対応タブが自動選択される
- [ ] タブクリックで対応ペインがアクティブになる（同 CWD 複数なら直近アクティブ）
- [ ] ペインを閉じたとき、参照ゼロになったタブが消える
- [ ] 折りたたんだディレクトリの watch が解除される（fs.watch ハンドル数を確認）
- [ ] ツリーの外でファイルを作成/削除すると、展開済みノードのみ自動反映される
