---
Status: ACTIVE
Created: 2026-04-30
Task: チャット UI 機能の完全廃止
Project: terminal-division
Related: archive 候補 → `.claude/2026-04-29-claude-code-chat-ui.md`（実装プラン本体）
---

# Plan: Remove Chat UI (T3-5 撤回)

## Context

### 動機

T3-5 として実装した「Claude Code Chat UI in Pane」は MVP として動作したが、以下のリスクから機能ごと撤回する：

- Claude **サブスクリプション** 認証 (`claude` CLI の `--bare` を意図的に外し、keychain/OAuth を経由する設計) を内部で利用しており、第三者配布したバイナリを通じてサブスクリプションを利用させる構成は **規約上グレー〜アウトの可能性が高い**
- 友人・知人など他者に DMG / ビルドが渡った場合、当該ユーザーの `claude` CLI ログインを介して同等の利用が可能になり、再配布リスクを助長する

→ コードを残すと「いつでも復活できてしまう」ため、依存・型・IPC・設定・ドキュメントを完全に剥がし、`viewMode` から `"chat"` を抹消する。

### スコープ

- `viewMode: "cli" | "md" | "chat"` から `"chat"` を削除し、`"cli" | "md"` の 2 値に縮約
- Renderer の ChatPane UI、Main の chat-session-manager / claude-process-detector / slash-items / trusted-dirs を物理削除
- `AppSettings.chat` および関連定数・セレクタ・テスト・UI 統合（フォントズーム分岐）を削除
- IPC チャネル `chat:*` を main / preload / renderer 全層から除去
- Tier Map / Known Issues / 実装プランを archive 化

### Non-Goals

- `claude` CLI そのものの利用や PTY 内での対話までは禁止しない（普通のシェル上でユーザーが手動起動するのは利用者責任で許容）
- 既に保存された `userData/trusted-dirs.json` のクリーンアップは「アンインストール時の挙動」としては手を入れない（ファイルが残っても害はないため）。**ただし Main 側のリーダーは消すので無用ファイル化する**点だけ MEMORY に残す
- セッション永続化のフォーマットは変更不要（`viewMode` は永続化対象外、MD タブ filePath のみ保存される現状を維持）

### 安全弁

- **削除前に main から worktree / branch を切る**（`feat/remove-chat-ui` 想定）。ユーザー指示で実体削除作業に入る前にこの計画書承認を得る
- `git mv` / `git rm` を使い、復活時に history から再取得できる状態を維持

---

## Files

### A. 完全削除（chat 専用、他用途なし）

| File                                                     | Operation | Notes                                    |
| -------------------------------------------------------- | --------- | ---------------------------------------- |
| `src/renderer/components/ChatPane/ChatPaneView.tsx`      | delete    | Chat UI コンテナ                         |
| `src/renderer/components/ChatPane/MessageList.tsx`       | delete    | チャット履歴                             |
| `src/renderer/components/ChatPane/MessageBubble.tsx`     | delete    | バブル描画                               |
| `src/renderer/components/ChatPane/ChatInput.tsx`         | delete    | 入力欄                                   |
| `src/renderer/components/ChatPane/ChatStatusBar.tsx`     | delete    | 進捗表示                                 |
| `src/renderer/components/ChatPane/ChatWelcome.tsx`       | delete    | ウェルカム                               |
| `src/renderer/components/ChatPane/ChatTrustPanel.tsx`    | delete    | 信頼確認モーダル                         |
| `src/renderer/components/ChatPane/SlashMenu.tsx`         | delete    | スラッシュ補完 UI                        |
| `src/renderer/components/ChatPane/`                      | rmdir     | 配下空になった時点でディレクトリごと削除 |
| `src/renderer/stores/chatSessionStore.ts`                | delete    | Chat Zustand ストア (283 行)             |
| `src/renderer/services/chatBridge.ts`                    | delete    | IPC リスナー (394 行)                    |
| `src/renderer/types/chat.ts`                             | delete    | ChatMessage 等の型                       |
| `src/shared/chat-events.ts`                              | delete    | ChatEventEnvelope                        |
| `src/main/chat-session-manager.ts`                       | delete    | claude CLI プロセス管理 (375 行)         |
| `src/main/claude-process-detector.ts`                    | delete    | OSC 0 自動検出 (102 行)                  |
| `src/main/slash-items.ts`                                | delete    | スラッシュコマンド一覧 (156 行)          |
| `src/main/__tests__/slash-items.test.ts`                 | delete    | slash-items テスト                       |
| `src/main/trusted-dirs.ts`                               | delete    | 信頼ディレクトリ管理 (85 行)             |
| `src/main/__tests__/trusted-dirs.test.ts`                | delete    | trusted-dirs テスト                      |
| `src/main/__tests__/claude-process-detector.test.ts`     | delete    | detector テスト                          |
| `src/renderer/stores/__tests__/chatSessionStore.test.ts` | delete    | chatSessionStore テスト                  |

→ **削除総数: 17 ファイル + 1 ディレクトリ**（合計 ~3,000 行）

### B. 部分修正（chat 関連行のみ削除 / 型縮約）

| File                                                      | Operation | Notes                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/ipc-handlers.ts`                                | edit      | L4-6 の import 3 行（`chatSessionManager` / `trustedDirsManager` / `listSlashItems`）削除。L476-536 の `chat:*` ハンドラ全 8 種削除。`app.on("before-quit")` 内 `chatSessionManager.killAll()` 削除                                                                                                                 |
| `src/main/window-manager.ts`                              | edit      | `claudeProcessDetector` import / `registerWindow` / `unregisterWindow` 呼び出しを削除                                                                                                                                                                                                                               |
| `src/main/pty-manager.ts`                                 | edit      | `claudeProcessDetector` import / `feedChunk` / `reset`（PTY 終了・ペイン削除時）の 3 呼び出しを削除                                                                                                                                                                                                                 |
| `src/preload/index.ts`                                    | edit      | L7 `import type { ChatEventEnvelope }` 削除。L218-261 の `api.chat` オブジェクト全削除                                                                                                                                                                                                                              |
| `src/renderer/main.tsx`                                   | edit      | `import { initChatBridge }` と `initChatBridge()` 呼び出しを削除                                                                                                                                                                                                                                                    |
| `src/renderer/App.tsx`                                    | edit      | `CHAT_FONT_SIZE_MIN/MAX` import 削除。`resolveActiveViewMode` の戻り値型を `"cli" \| "md" \| null` に縮約。`adjustGlobalFontSize` / `resetGlobalFontSize` の `if (mode === "chat") { ... }` ブロック（L88-98 / L123-127）削除。Shift+Enter 関連コメントから「Chat 入力欄など」を削除                                |
| `src/renderer/components/TerminalPane.tsx`                | edit      | `ChatPaneView` / `useChatSessionStore` import 削除。`isChat` / `hasChatSession` / `showChatTab` / `showChat` / `mountChat` 判定削除。ChatPaneView レンダリングブロック削除。`isOverlayed` を `showMd` のみに簡略化                                                                                                  |
| `src/renderer/components/TerminalSubHeader.tsx`           | edit      | L8 / L18 の chat 関連 import 削除。L99-198 周辺の `isChat` / `hasChatSession` / `showChatTab` / `handleClickChatTab` / `handleCloseChatTab` / `handleStartChat` 削除。`switchToMode` の引数型を `"cli" \| "md"` に縮約。L504-556 の Chat タブ UI 削除。「吹き出しアイコン」(handleStartChat の起動ボタン) UI も削除 |
| `src/renderer/stores/terminalMetaStore.ts`                | edit      | `export type ViewMode = "cli" \| "md" \| "chat"` → `"cli" \| "md"`。コメント中の "chat" 言及を削除                                                                                                                                                                                                                  |
| `src/shared/settings.ts`                                  | edit      | `ChatSettings` インタフェース削除。`AppSettings.chat` フィールド削除。`PartialAppSettings.chat` 削除。`CHAT_FONT_SIZE_MIN/MAX` 定数削除。`DEFAULT_SETTINGS.chat` 削除。`mergeSettings` / `cloneDefaults` / `validateAppSettings` の chat 分岐削除。`validateChatSettings` 関数削除                                  |
| `src/renderer/stores/settingsStore.ts`                    | edit      | `applyOptimistic` の `if (patch.chat) { ... }` 削除。`useChatSettings` セレクタ削除                                                                                                                                                                                                                                 |
| `src/shared/__tests__/settings.test.ts`                   | edit      | L142 `chat: { ...DEFAULT_SETTINGS.chat }` 削除。L259-265 `merges chat patch and clamps fontSize` ケース削除。L289-294 `validateAppSettings restores chat defaults for malformed chat block` ケース削除                                                                                                              |
| `src/renderer/stores/__tests__/terminalStore.test.ts`     | edit      | L12-18 周辺 `window.api` モックの `chat: { ... }` ブロック削除                                                                                                                                                                                                                                                      |
| `.claude/CLAUDE.md`                                       | edit      | §8 T2-10 説明文から chat 関連記述を除去（「`AppSettings` に `terminal / editor / chat / general`」→「`terminal / editor / general`」、「チャット: フォントサイズ」記述削除、`Cmd+=` 分岐の `chat` 行削除、「ターミナル個別ズームと独立して併用可能」表現は維持）。§3 等で chat 言及があれば併せて削除               |
| `.claude/docs/known-issues/INDEX.md`                      | edit      | Issue 003（claude-cli-stream-json）行を Active セクションから削除し、Resolved or Withdrawn セクションへ移動。または entry を削除して archive 化                                                                                                                                                                     |
| `.claude/docs/known-issues/003-claude-cli-stream-json.md` | move      | `archive/known-issues/003-claude-cli-stream-json.md` へ移動（or Status = Withdrawn 追記）                                                                                                                                                                                                                           |
| `.claude/2026-04-29-claude-code-chat-ui.md`               | move      | `archive/2026-04-29-claude-code-chat-ui.md` へ移動。冒頭 Status = WITHDRAWN（撤回理由: サブスクリプション再配布リスク）を追記                                                                                                                                                                                       |
| `.claude/MEMORY.md`                                       | edit      | task-tracker 経由で「進行中: chat UI 完全廃止」を追加 → 完了時に「直近の完了」へ                                                                                                                                                                                                                                    |
| `.claude/HISTORY.md`                                      | edit      | task-tracker 経由でセッション完了時に削除内容（撤回理由 + 削除ファイル一覧 + 残存リスク）を追記                                                                                                                                                                                                                     |

### C. 確認のみ（修正なし想定）

| File                                        | Notes                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/renderer/components/SettingsModal.tsx` | 既に Chat タブは存在しない（appearance/terminal/editor/shortcuts/window/general のみ）→ 変更不要 |
| `src/renderer/components/settings/*.tsx`    | grep 結果 chat 言及なし → 変更不要                                                               |
| `src/shared/session-state-validator.ts`     | viewMode は永続化対象外 → 変更不要                                                               |
| `src/preload/index.d.ts`                    | `Api` 型は `index.ts` から推論 → 自動反映、変更不要                                              |
| `package.json`                              | chat 専用依存なし（codemirror-markdown は MD タブで継続利用） → 変更不要                         |

---

## Steps

実装は以下の Phase 順で進める。各 Phase 末尾で `npm run build` / `npm test` がグリーンになることを確認してから次へ進む。

### Phase 0: 準備（1 セッション）

- [ ] 現状の作業ツリーが clean か確認（`git status`）。未コミットの chat 改修があればまず commit して `feat/T3-5 polish` のような作業ブランチに退避
- [ ] `feat/remove-chat-ui` ブランチを切る
- [ ] 本計画書 (`.claude/2026-04-30-remove-chat-ui.md`) を MEMORY.md に登録（task-tracker 経由）
- [ ] **削除前タグ付け**: 万一の復活用に `git tag pre-chat-removal` を打つ

### Phase 1: Renderer UI レイヤー削除（1 セッション）

依存方向の末端から削るので、ここを先にやってもビルドは通る（ただし import 不整合は残る → Phase 2 で解決）。

- [ ] `src/renderer/components/ChatPane/` 配下 8 ファイルを `git rm`
- [ ] ディレクトリを削除
- [ ] `src/renderer/stores/chatSessionStore.ts` と対応テストを `git rm`
- [ ] `src/renderer/services/chatBridge.ts` を `git rm`
- [ ] `src/renderer/types/chat.ts` を `git rm`
- [ ] **検証**: `tsc --noEmit` でエラー一覧を取得 → 残った参照箇所を Phase 2 の対象として確認

### Phase 2: Renderer 統合箇所の修正（1 セッション）

- [ ] `src/renderer/main.tsx`: `initChatBridge` 削除
- [ ] `src/renderer/App.tsx`:
  - [ ] `CHAT_FONT_SIZE_MIN/MAX` import 削除
  - [ ] `resolveActiveViewMode` 戻り値型と分岐から `"chat"` を削除
  - [ ] `adjustGlobalFontSize` / `resetGlobalFontSize` の chat 分岐削除
  - [ ] Shift+Enter 周りのコメント微調整
- [ ] `src/renderer/components/TerminalPane.tsx`:
  - [ ] ChatPane 関連 import 削除
  - [ ] `isChat` / `showChat` / `mountChat` / `hasChatSession` / `showChatTab` を全削除
  - [ ] ChatPaneView レンダリングブロック削除
  - [ ] `isOverlayed = showMd` に簡略化
- [ ] `src/renderer/components/TerminalSubHeader.tsx`:
  - [ ] chat 関連 import / state / handler / UI 全削除
  - [ ] segmented タブを MD タブのみで描画する分岐に整理
  - [ ] `switchToMode` の型を `"cli" \| "md"` に縮約
- [ ] `src/renderer/stores/terminalMetaStore.ts`:
  - [ ] `ViewMode` を `"cli" \| "md"` に縮約
  - [ ] コメントから "chat" 言及削除
- [ ] `src/renderer/stores/settingsStore.ts`:
  - [ ] `applyOptimistic` の `patch.chat` 分岐削除
  - [ ] `useChatSettings` セレクタ削除
- [ ] **検証**: `tsc --noEmit` がエラー 0、`npm test`（renderer 系）グリーン

### Phase 3: Main / Preload / Shared レイヤー削除（1 セッション）

- [ ] `src/main/chat-session-manager.ts` `git rm`
- [ ] `src/main/claude-process-detector.ts` + テスト `git rm`
- [ ] `src/main/slash-items.ts` + テスト `git rm`
- [ ] `src/main/trusted-dirs.ts` + テスト `git rm`
- [ ] `src/shared/chat-events.ts` `git rm`
- [ ] `src/main/ipc-handlers.ts`:
  - [ ] import 3 行削除
  - [ ] `chat:start` / `chat:send` / `chat:stop` / `chat:dispose` / `chat:getSessionId` / `chat:checkTrust` / `chat:trust` / `chat:listSlashItems` の 8 ハンドラ削除
  - [ ] `before-quit` の `killAll()` 削除
- [ ] `src/main/window-manager.ts`: detector の register / unregister 削除
- [ ] `src/main/pty-manager.ts`: detector の feedChunk / reset 削除
- [ ] `src/preload/index.ts`: `ChatEventEnvelope` import + `api.chat` オブジェクト削除
- [ ] **検証**: `npm run build`（main + preload + renderer 全部）成功、`npm test` 全 green

### Phase 4: 設定スキーマ・テストの整理（1 セッション）

- [ ] `src/shared/settings.ts` から chat 関連を完全除去
- [ ] `src/shared/__tests__/settings.test.ts` の chat ケース 2 件 + base AppSettings の `chat:` フィールド削除
- [ ] `src/renderer/stores/__tests__/terminalStore.test.ts` の `window.api.chat` モック削除
- [ ] **検証**: `npm test` 全 green、カバレッジ低下が許容範囲内（chat 削除分の自然減のみ）

### Phase 5: ドキュメント・プラン整理（1 セッション）

- [ ] `.claude/CLAUDE.md` §8 T2-10 を chat なし版に書き換え
- [ ] `.claude/docs/known-issues/INDEX.md` から Issue 003 の Active 行を削除（または Withdrawn セクション新設）
- [ ] `.claude/docs/known-issues/003-claude-cli-stream-json.md` 冒頭に `Status: Withdrawn (2026-04-30)` と理由を追記し、`.claude/docs/known-issues/archive/` 下へ `git mv`（archive サブディレクトリがなければ作成）
- [ ] `.claude/2026-04-29-claude-code-chat-ui.md` 冒頭に `Status: WITHDRAWN (2026-04-30, reason: subscription redistribution risk)` を追記し `.claude/archive/` へ `git mv`
- [ ] `.claude/MEMORY.md`: task-tracker で「直近の完了」に "Chat UI 完全廃止" を追記
- [ ] `.claude/HISTORY.md`: 削除セッションの記録を追加

### Phase 6: 最終検証 & コミット粒度確認（1 セッション）

- [ ] **残存参照ゼロ確認** (Verification セクション参照)
- [ ] `npm run build` / `npm test` 最終グリーン
- [ ] `npx electron-builder --mac --dir` で実機起動確認: ペイン分割 / MD エディタ / 設定 UI / Cmd+= ズーム（cli・md のみ反応）/ ショートカット が動作することを確認
- [ ] コミット粒度を整理（Phase 単位推奨: `chore(chat): remove ChatPane UI`、`chore(chat): remove main process handlers`、`chore(chat): drop chat settings & viewMode union`、`docs: archive chat plan & known-issue 003`）
- [ ] PR タイトル: `chore: remove Chat UI feature` / 本文に撤回理由（subscription redistribution risk）を必ず明記
- [ ] **マージ前**: 元の T3-5 ブランチタグ `pre-chat-removal` をリモートにも push しておく（復活オプション保持）

---

## Verification

各項目はチェックボックスで pass/fail を判定可能：

### コンパイル / テスト

- [ ] `npm run build` が warning 0 / error 0 で完了
- [ ] `npm test` が全 case green、`chat` を含むテスト名はゼロ
- [ ] `npx tsc --noEmit` がエラーなし

### 残存参照ゼロ（grep でゼロ件）

```bash
# 1) コードからの chat 参照（コメント含む全削除確認）
grep -r "ChatPane\|chatSession\|ChatMessage\|ChatEventEnvelope\|chatBridge\|claudeProcessDetector\|trustedDirsManager\|listSlashItems" src/ --include="*.ts" --include="*.tsx"
# → 期待: 0 件

# 2) viewMode "chat" 残存
grep -rE 'viewMode.*[=!]==?\s*"chat"|"cli"\s*\|\s*"md"\s*\|\s*"chat"' src/ --include="*.ts" --include="*.tsx"
# → 期待: 0 件

# 3) IPC チャネル名残存
grep -rE '"chat:(start|send|stop|dispose|getSessionId|checkTrust|trust|listSlashItems|event|claudeDetected)"' src/ --include="*.ts" --include="*.tsx"
# → 期待: 0 件

# 4) settings.chat 残存
grep -rE 'CHAT_FONT_SIZE|settings\.chat|AppSettings\["chat"\]|useChatSettings' src/ --include="*.ts" --include="*.tsx"
# → 期待: 0 件
```

### 動作確認（実機 / electron-vite dev）

- [ ] アプリ起動 → 単一ペインが立ち上がる
- [ ] Cmd+D / Cmd+Shift+D で水平 / 垂直分割が動作
- [ ] ペインヘッダーに **Chat タブが出ない**（吹き出しアイコンも非表示）
- [ ] サイドバーから .md ファイルを「編集する」→ MD タブが開き、CLI/MD 切替が動作
- [ ] Cmd+= / Cmd+- がアクティブ viewMode に応じて反応:
  - cli: terminal.fontSize が増減
  - md: editor.fontSize が増減
  - **(削除済み) chat: 反応しない（そもそも viewMode に存在しない）**
- [ ] Cmd+0 で各 viewMode のフォントサイズがデフォルトに戻る
- [ ] 設定モーダルが「外観 / ターミナル / エディタ / ショートカット / ウィンドウ / 一般」のみで、Chat タブが存在しない
- [ ] PTY 内で `claude` コマンドを起動しても、ペインの viewMode は cli のまま（自動 chat 切替が起きない）
- [ ] アプリ終了 → 再起動でセッション復元が正常動作（レイアウト + CWD + MD タブ）

### ドキュメント整合

- [ ] `.claude/CLAUDE.md` 内に "chat" / "Chat" の単語が **意図しない箇所に** 残っていない（HISTORY 引用や Known Issue 003 への言及は OK だが、Tier Map / Architecture / Coding Standards から消えていること）
- [ ] `.claude/2026-04-29-claude-code-chat-ui.md` が `archive/` 配下にあり Status: WITHDRAWN
- [ ] `.claude/docs/known-issues/INDEX.md` に Issue 003 の Active 行がない
- [ ] `.claude/MEMORY.md` の「直近の完了」に "Chat UI 完全廃止" が記載

---

## Risks & Mitigations

| Risk                                                                               | Mitigation                                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 削除後に「やっぱり機能を残したい」となった場合の復活コスト                         | Phase 0 で `git tag pre-chat-removal` を打ち、archive 配下にプラン・Known Issue を残す。実装は git history から `git checkout pre-chat-removal -- <path>` で個別復元できる |
| `viewMode` の union 縮約による型エラーの取りこぼし                                 | Phase 2 末で `tsc --noEmit` を必ず通す。`switchToMode` などの引数を厳密化し、暗黙の `as ViewMode` キャストがないか確認                                                     |
| `userData/trusted-dirs.json` などの旧データが残ったまま                            | 害はないが、CLAUDE.md または HISTORY.md に「不要ファイルが残る可能性あり」と記載しておく。次バージョンで起動時 cleanup を入れるかは別タスク                                |
| MD タブやペイン関連のテストが chat 前提のセットアップに依存していて green が崩れる | Phase 2 と Phase 4 のテスト修正で吸収。`window.api.chat` モックは `terminalStore.test.ts` のみが触れている想定なので影響は限定的                                           |
| `pre-chat-removal` タグを忘れて push しないまま削除コミットが先行マージされる      | Phase 6 のコミット粒度確認時にタグ push 状況を確認チェックリストに含める                                                                                                   |
| Known Issue 003 を archive 化したが将来 PTY 内で `claude` 起動を扱う際に参照したい | `archive/known-issues/` 配下に保存し、INDEX.md には「Withdrawn but kept for reference」程度のメタ行を残す                                                                  |

---

## Open Questions（実装着手前にユーザー確認）

1. **ブランチ運用**: 本変更を `feat/remove-chat-ui` で進め、PR で main へマージする想定で良いか？（直接 main にコミットするほどの小変更ではないため）
2. **`pre-chat-removal` タグ**: 復活用にタグを打って push する運用で問題ないか？（タグだけ残しコードは履歴から取り出す方針）
3. **既存ユーザーの `userData/trusted-dirs.json` 残存**: 起動時の自動クリーンアップを今回入れる / 入れない？（**入れない** を推奨：実害なし + 削除作業のスコープ膨張を避けるため）
4. **コミット粒度**: Phase 単位の 4〜6 コミットに分割する案で良いか？（あるいは「全部 1 コミット」希望か）
5. **archive 配下の `Status` 表記**: `WITHDRAWN` / `Withdrawn` のどちらに統一するか（既存 archive ファイルの慣習に合わせる）

これらを確認した上で Phase 0 → 6 を順次実行する。
