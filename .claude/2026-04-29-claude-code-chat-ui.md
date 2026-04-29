---
Status: DRAFT (要件確認待ち)
Created: 2026-04-29
Task: T3-5（候補） Claude Code Chat UI in Pane
Project: /Users/newlife/dev/apps/terminal-division
---

# Plan: Claude Code Chat UI in Pane

## Context

### 動機

ユーザーがペイン内で `claude` CLI（Claude Code）を起動した際、TUI のままではなく **claude.ai のような専用チャット UI** に切り替えて使えるようにする。CLI の生出力をチャット UI 側に反映し、ユーザー入力もチャット UI 経由で送れる構造にする。

### 前提

- **認証は Anthropic API キーではなくサブスクリプション（Claude Pro / Max OAuth）で行う**
- terminal-division は **Anthropic API を直接叩かない**。既存の `claude` CLI プロセスを node-pty / 子プロセスで起動し、その入出力をラップして UI 化することで、認証は claude CLI に委譲する
- 既存 T2-8（Markdown Editor）と同じ **per-pane viewMode 拡張パターン** を踏襲（`viewMode = "cli" | "md" | "chat"`）

### スコープ

**MVP（Phase 1〜3）**

- ペインヘッダーに「Chat」タブを追加（CLI / MD / Chat の 3 ビュー）
- Chat ビュー起動時、対象ペインで `claude` を構造化出力モード（要 Phase 0 検証）でバックエンド起動
- ユーザー / アシスタント発言をチャットバブル UI で表示（Markdown レンダリング）
- ツール使用（Read / Edit / Bash 等）を折りたたみカードで表示
- ストリーミング表示（トークン逐次レンダリング）
- 入力欄: Enter 送信 / Shift+Enter 改行 / Cmd+Enter で送信のキーバインド
- セッション中断（停止ボタン）
- CLI ↔ Chat のビュー切替（PTY とチャットセッションは独立、状態保持）

**Phase 4 以降**

- 自動検出（`claude` コマンド実行を検知して Chat ビュー切替を提案）
- 添付ファイル D&D（チャット入力欄に Finder からファイルをドロップ → パス挿入）
- 会話セッション復元（claude CLI の `--resume` 連携）

### Non-Goals

- **Anthropic API 直接呼び出し**: SDK を入れない、API キー管理 UI も持たない。認証は全て claude CLI に委譲
- **claude CLI 以外の AI CLI 対応**（codex / aider / gemini 等）— MVP 範囲外
- **会話履歴のアプリ独自永続化**: claude CLI 側のセッション機構を利用、独自 JSON 化はしない
- **マルチモデル切替 UI**: モデル選択は `claude` CLI の引数 / 設定に任せる
- **ツール承認フロー UI のフル再現**: 初版は claude CLI のデフォルト承認動作に従う（承認 prompt はチャット内のシステムメッセージとして表示するのみ）

### 既知の制約

- claude CLI の構造化出力モード（`--output-format stream-json` 等）の正確な仕様は **Phase 0 で検証必須**
- 既存 PTY パネルとの共存: viewMode 切替時に PTY を破棄しない（MD モードと同じ生存戦略）
- IME / capture-phase keydown: chat 入力中はターミナル系ショートカットを抑制する分岐が必要（MD モードと同じ）
- contextIsolation: 子プロセス起動 / stdin 書き込み / stdout 受信は全て IPC 経由

---

## Open Questions（要件確認）

実装着手前にユーザー判断が必要な点：

### Q1. Chat ビューの起動トリガー

- **A.** ペインヘッダーに常時「Chat」タブを表示し、ユーザーが明示的に切り替える
- **B.** ユーザーが PTY で `claude` を実行したら自動検出して切替を提案するモーダル
- **C.** A + B 両対応（手動でも自動でも入れる）

→ **推奨: A（MVP）→ Phase 4 で C に拡張**

### Q2. CLI ↔ Chat 切替時の挙動

- **A.** 完全独立: CLI モードの PTY と Chat モードの claude プロセスは別物。切替で会話履歴は引き継がない
- **B.** Chat → CLI 戻り時に claude CLI を `--resume` で再起動して TUI で継続
- **C.** Chat と CLI を同一の claude プロセスで共有（screen-scrape）

→ **推奨: A（MVP のシンプルさ優先）**

### Q3. 構造化出力プロトコル

- claude CLI は `--output-format stream-json --input-format stream-json` でストリーミング JSONL に対応している想定だが、**Phase 0 で実機確認**が必要
- もし利用不可なら、TUI 出力を ANSI パース + 状態機械でメッセージ抽出するフォールバックが必要（精度劣化）

→ **推奨: Phase 0 で確定。stream-json が使えない場合はスコープ縮小して Q4 に進む**

### Q4. ツール使用イベントの表示粒度

- **A.** ツール名 + 引数 + 結果をすべて折りたたみカードで表示（claude.ai 風）
- **B.** ツール名のみアイコンで表示し、詳細はクリックで展開
- **C.** ツール使用は表示せず、最終アシスタント応答のみ表示

→ **推奨: B（情報量と視認性のバランス）**

### Q5. 入力欄の高さ・添付

- 行数固定（最大 8 行で内部スクロール）か、自動拡張か
- ファイル添付は Phase 1 から入れるか Phase 4 か

→ **推奨: 自動拡張（min 1 / max 8 行）+ 添付は Phase 4**

---

## Architecture

### 3.1 データフロー（MVP / stream-json 前提）

```
[Renderer Chat UI]
  ├─ 入力 textarea
  │     └─→ IPC: chat:send(paneId, content)
  │           └─→ Main: ChatSessionManager.write(paneId, JSONL)
  │                 └─→ child_process(claude --output-format stream-json --input-format stream-json).stdin
  │
  └─ メッセージ表示
        ↑─ IPC event: chat:event(paneId, {type, payload})
              ↑─ Main: stream-json パーサー（行単位で JSON.parse）
                    ↑─ claude プロセス stdout
```

### 3.2 プロセス管理

- 新規モジュール `src/main/chat-session-manager.ts`
  - `ChatSession`: `{ paneId, child: ChildProcess, cwd, status, ... }`
  - `start(paneId, cwd, options)`: `child_process.spawn("claude", ["--output-format", "stream-json", "--input-format", "stream-json"], { cwd, env: ... })`
  - `write(paneId, content)`: ユーザーメッセージを JSONL でエンコードし stdin へ書込
  - `stop(paneId)`: SIGTERM
  - `dispose(paneId)`: 終了 + リソース解放
- node-pty は使わない（TTY 不要、プレーン子プロセスで stdin/stdout バイト列を扱う）
- claude バイナリ解決は既存 PTY と同様のロジック（PATH 探索 / フォールバック）を共有関数化

### 3.3 IPC

- `chat:start(paneId, cwd, options)` → `{ ok, sessionId }`
- `chat:send(paneId, content)` → `{ ok }`
- `chat:stop(paneId)` → `{ ok }`
- `chat:dispose(paneId)` → `{ ok }`
- `chat:event` (主→補, push): `{ paneId, event: { type, ... } }`
  - `type`: `"assistant.delta"` / `"assistant.complete"` / `"tool_use"` / `"tool_result"` / `"system"` / `"error"` / `"end"`

### 3.4 Renderer State

- `chatSessionStore`（新規 Zustand）
  - `sessions: Map<paneId, ChatState>`
  - `ChatState`: `{ messages: ChatMessage[], status: "idle" | "streaming" | "error", currentAssistantBuffer: string }`
  - actions: `appendDelta` / `finalizeAssistant` / `addToolUse` / `addToolResult` / `addError` / `reset`
- `terminalMetaStore`: `viewMode: "cli" | "md" | "chat"` を追加（MD モード拡張）
- セッション永続化対象から chat 状態は **除外**（再起動時は CLI に戻る）

### 3.5 UI

- `src/renderer/components/ChatPane/`
  - `ChatPaneView.tsx`: ペインの Chat ビュー本体（メッセージリスト + 入力欄）
  - `MessageList.tsx`: 仮想スクロール（react-virtuoso 検討、軽量なら自前）
  - `MessageBubble.tsx`: User / Assistant の発言バブル。Markdown レンダリングは既存依存（CodeMirror 6 もしくは `react-markdown` 軽量利用）
  - `ToolUseCard.tsx`: 折りたたみ可能なツール呼び出し表示
  - `ChatInput.tsx`: 自動高さ拡張 textarea + 送信ボタン + 停止ボタン
  - `ChatStatusBar.tsx`: ストリーミング中インジケータ / エラー
- ペインヘッダー（`TerminalSubHeader.tsx`）に Chat タブを追加（CLI / MD / Chat）

### 3.6 認証フロー

- 初回起動時 claude CLI 自体が OAuth ブラウザフローを発火する（未認証時）。terminal-division はその挙動に介入しない
- 未認証検出時の UX: stream-json モードでは認証が必要なら stderr / 終了コードで示される想定 → `chat:event` の `error` で UI に「`claude /login` を CLI モードで実行してください」と案内
- これは Phase 0 で実機確認

---

## Steps

### Phase 0: 事前検証（着手判断）

- [ ] **0-1.** `claude --output-format stream-json --input-format stream-json` の実機検証
  - 入出力 JSONL のスキーマ調査（`type`, `subtype`, `delta`, `tool_use_id`, ...）
  - 1 セッション内で複数ターンの対話が可能か / `--resume <id>` の挙動
  - 終了条件（最終 `end` イベントの有無）
  - 未認証時の振る舞い
- [ ] **0-2.** ツール承認プロンプトの扱い検証（`--allowedTools` / `--dangerously-skip-permissions` の影響）
- [ ] **0-3.** 検証結果を `.claude/docs/known-issues/003-claude-cli-stream-json.md` に記録（Phase 1 設計の根拠資料）
- [ ] **0-4.** 検証結果を踏まえ、本プランを **REVIEW** ステータスに更新してユーザー承認を取る

### Phase 1: 基盤（IPC + Main プロセス）

- [ ] **1-1.** `src/main/chat-session-manager.ts` 新規作成（`ChatSession` 構造体、spawn / write / stop / dispose）
- [ ] **1-2.** stream-json パーサー: 行バッファリング + 不完全 JSON ハンドリング
- [ ] **1-3.** `src/main/ipc-handlers.ts` に `chat:start` / `chat:send` / `chat:stop` / `chat:dispose` 追加
- [ ] **1-4.** Main → Renderer push イベント: `webContents.send("chat:event", ...)`
- [ ] **1-5.** `src/preload/index.ts` + `index.d.ts` に `window.api.chat.*` 公開
- [ ] **1-6.** claude バイナリ解決を `src/main/cli-resolver.ts` に共通化（既存 PTY からの抽出）

### Phase 2: Renderer State + メッセージモデル

- [ ] **2-1.** `src/renderer/types/chat.ts`: `ChatMessage` / `ToolUse` / `ToolResult` 型定義
- [ ] **2-2.** `src/renderer/stores/chatSessionStore.ts`: Zustand ストア + アクション + テスト
- [ ] **2-3.** `terminalMetaStore` の `viewMode` 拡張（`"cli" | "md" | "chat"`）+ アクション + テスト
- [ ] **2-4.** `src/renderer/services/chatBridge.ts`: `window.api.chat.*` ↔ store の橋渡し（IPC イベント subscribe / 入力送出）

### Phase 3: UI コンポーネント

- [ ] **3-1.** `ChatPaneView.tsx`: コンテナ + ライフサイクル（mount で `chat:start`、unmount は dispose しない＝ MD と同じ）
- [ ] **3-2.** `MessageList.tsx`: 自動スクロール（最下部追従、ユーザーが上にスクロール中は固定）
- [ ] **3-3.** `MessageBubble.tsx`: User / Assistant 識別、Markdown 表示、コードブロックハイライト
- [ ] **3-4.** `ToolUseCard.tsx`: 折りたたみ + ツール名アイコン
- [ ] **3-5.** `ChatInput.tsx`: 自動拡張 textarea、Enter / Shift+Enter / Cmd+Enter、IME ガード、送信中は disable
- [ ] **3-6.** `ChatStatusBar.tsx`: streaming インジケータ + 停止ボタン + エラー表示
- [ ] **3-7.** `TerminalSubHeader.tsx`: タブ群（CLI / MD / Chat）に拡張、現在タブのスタイル

### Phase 4: 統合 + ショートカット + ガード

- [ ] **4-1.** `App.tsx`: capture-phase keydown で Chat フォーカス時はターミナルショートカットを抑制（MD と同じパターン）
- [ ] **4-2.** Chat 入力中の Cmd+W: PTY 破棄ではなくモーダル確認（streaming 中なら停止確認）
- [ ] **4-3.** ショートカットモーダル（`ShortcutsModal.tsx`）に Chat 系ショートカット追記
- [ ] **4-4.** ペイン分割時 / close 時に chat session を dispose
- [ ] **4-5.** 認証エラー時の UI: 「CLI モードで `claude /login` を実行してください」リンク（CLI タブにフォーカス遷移ボタン）

### Phase 5: 仕上げ + ドキュメント

- [ ] **5-1.** `CLAUDE.md` §3 Architecture に「3.9 Chat Session Manager」追加
- [ ] **5-2.** `CLAUDE.md` §8 Feature Tier Map に **T2-11**（または T3-5）として追記
- [ ] **5-3.** `docs/requirements/tier-2-supporting.md`（または tier-3-experimental）に詳細追記
- [ ] **5-4.** `docs/code-explanation/06-chat-session.md` 新規（学習教材）
- [ ] **5-5.** README にセクション追加（前提: claude CLI が PATH に存在 + ログイン済）

---

## Files

| File                                                      | Operation       | Notes                                                  |
| --------------------------------------------------------- | --------------- | ------------------------------------------------------ |
| `src/main/chat-session-manager.ts`                        | **new**         | 子プロセス spawn / stdin/stdout 管理                   |
| `src/main/cli-resolver.ts`                                | **new**（抽出） | claude / shell バイナリ解決の共通ロジック              |
| `src/main/ipc-handlers.ts`                                | modify          | `chat:*` IPC ハンドラ追加                              |
| `src/preload/index.ts`                                    | modify          | `window.api.chat.*` 公開                               |
| `src/preload/index.d.ts`                                  | modify          | 型定義                                                 |
| `src/renderer/types/chat.ts`                              | **new**         | ChatMessage / ToolUse 型                               |
| `src/renderer/stores/chatSessionStore.ts`                 | **new**         | Zustand chat ストア                                    |
| `src/renderer/stores/__tests__/chatSessionStore.test.ts`  | **new**         | ストアテスト                                           |
| `src/renderer/stores/terminalMetaStore.ts`                | modify          | `viewMode` に `"chat"` 追加                            |
| `src/renderer/services/chatBridge.ts`                     | **new**         | IPC ↔ store ブリッジ                                   |
| `src/renderer/components/ChatPane/ChatPaneView.tsx`       | **new**         | コンテナ                                               |
| `src/renderer/components/ChatPane/MessageList.tsx`        | **new**         | メッセージリスト                                       |
| `src/renderer/components/ChatPane/MessageBubble.tsx`      | **new**         | User / Assistant バブル                                |
| `src/renderer/components/ChatPane/ToolUseCard.tsx`        | **new**         | ツール表示                                             |
| `src/renderer/components/ChatPane/ChatInput.tsx`          | **new**         | 入力欄                                                 |
| `src/renderer/components/ChatPane/ChatStatusBar.tsx`      | **new**         | ステータス + 停止                                      |
| `src/renderer/components/ChatPane/__tests__/*.test.tsx`   | **new**         | UI テスト                                              |
| `src/renderer/components/TerminalSubHeader.tsx`           | modify          | Chat タブ追加                                          |
| `src/renderer/components/SplitContainer.tsx`              | modify          | viewMode 分岐に "chat" を追加                          |
| `src/renderer/App.tsx`                                    | modify          | capture-phase ショートカットの Chat ガード             |
| `src/renderer/shortcuts/registry.ts`                      | modify          | chat 系（必要なら）                                    |
| `package.json`                                            | modify          | `react-markdown`（または既存資産で済むか検討）追加判断 |
| `.claude/docs/known-issues/003-claude-cli-stream-json.md` | **new**         | Phase 0 検証ログ                                       |
| `.claude/docs/code-explanation/06-chat-session.md`        | **new**         | 学習教材                                               |
| `.claude/docs/requirements/tier-2-supporting.md`          | modify          | T2-11 追記（Tier 判断後）                              |
| `.claude/CLAUDE.md`                                       | modify          | §3 / §8 更新                                           |

---

## Verification

### 機能受入

- [ ] CLI タブで `claude` を一切起動せず、Chat タブを開くだけで対話できる
- [ ] ユーザー発言を送信 → アシスタント応答がストリーミングで表示される
- [ ] ツール使用（Read / Edit / Bash 等）が折りたたみカードで表示され、結果も確認できる
- [ ] CLI ↔ Chat タブ切替後も双方の状態が保持される（PTY 出力 / chat メッセージ）
- [ ] 停止ボタンでストリーミングを中断できる
- [ ] 未認証時にユーザーに案内が出る（`claude /login` ガイド）
- [ ] ペイン close（Cmd+W）時に chat プロセスが確実に終了する（プロセスリーク無し）
- [ ] IME 入力中の Enter で誤送信されない

### 非機能

- [ ] `npm test` が通る（既存テスト破壊なし）
- [ ] `npm run build` が通る（型エラーなし）
- [ ] パッケージ版（`electron-builder --mac --dir`）でも claude バイナリが解決できる
- [ ] Anthropic API キーが `process.env` / 設定 / コードのいずれにも存在しない（grep 確認）

### Known Issue 監視

- [ ] stream-json プロトコルの破壊的変更に対する fallback / バージョン警告
- [ ] claude CLI 未インストール / 古バージョン時のエラー文言

---

## 関連ドキュメント

- 設計原則: [`docs/vision/coding-principles.md`](./docs/vision/coding-principles.md)
- 既存 viewMode 拡張パターン: [`archive/2026-04-26-markdown-editor.md`](./archive/2026-04-26-markdown-editor.md)
- Tier Map: [`CLAUDE.md`](./CLAUDE.md) §8

---

## 次アクション

1. ユーザーが本プランの **Open Questions Q1〜Q5** に回答
2. Phase 0（claude CLI stream-json 検証）に着手 → 結果次第でスコープ調整
3. `task-tracker` で MEMORY.md に登録
