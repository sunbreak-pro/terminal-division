---
Status: WITHDRAWN
Created: 2026-04-29
Updated: 2026-05-02 (機能ごと撤回)
Withdrawn: 2026-05-02
WithdrawnReason: Claude サブスクリプション認証を経由する Chat UI を同梱するアプリの第三者配布は規約上グレー〜アウトのリスクが高く、機能ごと削除した。`pre-chat-removal` タグに削除直前のコードが残っており、復活時はそこから個別 cherry-pick できる。
Task: T3-5 Claude Code Chat UI 実装 + 複数 MD タブ対応（Chat UI 部分のみ撤回、複数 MD タブ対応は本体に残存）
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
- **PTY で `claude` 実行を自動検出 → Chat ビューへ切替**（Q1=自動検出 採用）
- Chat ビュー起動時、対象ペインで `claude` を構造化出力モード（要 Phase 0 検証）でバックエンド起動
- **CLI ↔ Chat 切替時は会話セッションを継続**（Q2=継続 採用、`--resume <session-id>` 連携前提 / Phase 0 で実現可否確定）
- ユーザー / アシスタント発言をチャットバブル UI で表示（Markdown レンダリング）
- ストリーミング表示（トークン逐次レンダリング）
- 入力欄:
  - Enter 送信 / Shift+Enter 改行 / Cmd+Enter で送信のキーバインド
  - **3 行までは自動拡張、4 行以上は固定高さで内部スクロール**（Q5）
  - 入力上限はパフォーマンスが劇的に劣化しない範囲（目安 64KB / 約 65,000 文字、`react-markdown` 等のレンダラ計測値で調整）
- セッション中断（停止ボタン）
- CLI ↔ Chat のビュー切替後も双方の状態保持（PTY バッファ / chat メッセージ）

**MVP では実装しない（後続評価）**

- **ツール使用イベントの可視化**（Q4: 一旦なし）
  - MVP は最終アシスタント応答のみ表示。ツール使用中は ChatStatusBar に「Claude が作業中...」とだけ表示
  - 実装感 / 情報量を見て、Phase 4 で Q4 を再判断（A: フルカード / B: アイコンのみ / C: 表示なし継続）
- 自動検出後の「切替提案モーダル」: MVP では **即時自動切替**（モーダルなし）。煩わしさが出れば Phase 4 で「次回から自動切替しない」チェックボックス導入

**Phase 4 以降**

- ツール使用イベントの可視化（折りたたみカード or アイコン表示）
- 自動切替の suppress オプション（モーダル化 / 設定）
- 添付ファイル D&D（チャット入力欄に Finder からファイルをドロップ → パス挿入）
- 会話履歴の永続化（再起動後の復元 — claude CLI のセッションストア依存）
- 他 AI CLI（codex / aider / gemini）対応の可否評価

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

## Open Questions（確定済み）

### Q1. Chat ビューの起動トリガー → **自動検出**

ユーザーが PTY で `claude` を実行したら自動検出して Chat ビューへ即時切替。MVP ではモーダル確認なし（煩わしさが顕在化したら Phase 4 で suppress オプション）。手動切替（ペインヘッダーの Chat タブ）も併存。

**実装方針（Phase 0 で最終確定）**:

- 第一手: PTY 出力ストリームを監視し、claude CLI のバナー（または独自マーカー）を検出
- 第二手: macOS の `tcgetpgrp(fd) → ps` で foreground プロセス名を定期確認（軽量ポーリング、500ms）
- ベスト: claude CLI が起動時に固有の ANSI シーケンス / OSC を出力するなら、それを検知

### Q2. CLI ↔ Chat 切替時の挙動 → **継続**

会話セッションを引き継ぐ。

**実装方針**:

- Chat 起動時に PTY の claude を一度終了させ、`session-id` を取得
- Chat バックエンドは `claude --resume <session-id> --output-format stream-json --input-format stream-json` で起動
- Chat → CLI 戻り時は同様に `claude --resume <session-id>` を PTY で起動して TUI 継続
- **session-id の取得経路** は Phase 0 で確定（候補: claude が emit する OSC、`~/.claude/sessions/` 等のファイルストア、stream-json イベントの `session_id` フィールド）
- 切替コスト（ms 単位の停止 → 再起動）はユーザーに「会話を読み込み中...」表示でカバー

### Q3. 構造化出力プロトコル → **Phase 0 で確定**

`claude --output-format stream-json --input-format stream-json` の利用可否、JSONL スキーマ、`--resume` の挙動、未認証時の振る舞いを実機検証。

**fallback 戦略**:

- stream-json が双方向ストリーミングに非対応の場合 → ターン単位の one-shot 起動（`claude -p "<msg>" --resume <id>`）に切替。会話履歴は claude CLI の session store に依存
- どちらも不可の場合 → スコープを大幅縮小して TUI screen-scrape 路線（精度低下、要再合意）

### Q4. ツール使用イベントの表示 → **MVP ではなし**

最終アシスタント応答のみ表示。ストリーミング中は ChatStatusBar に「Claude が作業中...」とインジケータのみ。Phase 3 完了時点で UI/UX を評価し、Phase 4 で表示方式を再判断。

### Q5. 入力欄 → **3 行までは自動拡張、4 行以上はスクロール**

- min 1 行 / 自動拡張（max 3 行）
- 4 行以上は固定高さ（`max-height: 3行分`）で内部スクロール（`overflow-y: auto`）
- 入力上限: パフォーマンス計測ベースで決定。目安 **64KB / 約 65,000 文字**（react-markdown / textarea 双方の負荷を Phase 3 後半で実測）
- ファイル添付は Phase 4 以降

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
  - `ChatSession`: `{ paneId, child: ChildProcess, cwd, sessionId, status, ... }`
  - `start(paneId, cwd, { resumeSessionId? })`: `child_process.spawn("claude", [...(resumeSessionId ? ["--resume", resumeSessionId] : []), "--output-format", "stream-json", "--input-format", "stream-json"], { cwd, env: ... })`
  - `write(paneId, content)`: ユーザーメッセージを JSONL でエンコードし stdin へ書込
  - `stop(paneId)`: SIGTERM（会話継続のため session-id は保持して終了）
  - `dispose(paneId)`: 終了 + リソース解放
  - `getSessionId(paneId)`: CLI 戻り時に PTY 側へ渡す
- node-pty は使わない（TTY 不要、プレーン子プロセスで stdin/stdout バイト列を扱う）
- claude バイナリ解決は既存 PTY と同様のロジック（PATH 探索 / フォールバック）を共有関数化

### 3.2.1 自動検出（PTY → Chat）

- 新規モジュール `src/main/claude-process-detector.ts`
  - PTY 出力ストリーム監視: `pty-manager` から chunk を受信 → claude CLI の起動マーカー（バナー / OSC シーケンス、Phase 0 で確定）を検出
  - foreground プロセス確認: `tcgetpgrp(ptyFd)` → `ps -o comm= -p <pid>` で `claude` 名一致を裏取り（500ms ポーリング、検出後はポーリング停止）
  - 検出時 `chat:claudeDetected(paneId, sessionId?)` を Renderer に push
- Renderer 側: イベント受信で `terminalMetaStore.setViewMode(paneId, "chat")` を呼ぶ + `chatSessionStore` に `--resume` 用 sessionId を渡して start
- PTY 側 claude は終了させる（重複起動回避）。停止時の状態は `claude /exit` 相当ではなく SIGTERM だが、session-id ベースで Chat 側が継続

### 3.3 IPC

- `chat:start(paneId, cwd, { resumeSessionId? })` → `{ ok, sessionId }`
- `chat:send(paneId, content)` → `{ ok }`
- `chat:stop(paneId)` → `{ ok }`（プロセス停止、sessionId は保持）
- `chat:dispose(paneId)` → `{ ok }`（完全破棄）
- `chat:getSessionId(paneId)` → `{ sessionId | null }`（CLI 戻り時に PTY 起動引数で使う）
- `chat:event` (主→補, push): `{ paneId, event: { type, ... } }`
  - `type`: `"assistant.delta"` / `"assistant.complete"` / `"tool_use"` / `"tool_result"` / `"system"` / `"error"` / `"end"` / `"session.id"`（初回 session-id 取得通知）
  - **MVP では `tool_use` / `tool_result` を Renderer 側で受信のみ（store には保存）し、UI には反映しない**。Phase 4 評価用にデータ保持
- `chat:claudeDetected` (主→補, push): `{ paneId, sessionId? }` — PTY での claude 起動を検出

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
  - `MessageList.tsx`: 自動スクロール（react-virtuoso は MVP 不採用、自前 + `IntersectionObserver`）
  - `MessageBubble.tsx`: User / Assistant の発言バブル。Markdown レンダリングは `react-markdown` + `remark-gfm`（既存依存に同等品なし、追加判断は Phase 3 開始時）
  - `ChatInput.tsx`: 1〜3 行自動拡張 + 4 行以上で内部スクロール、送信ボタン + 停止ボタン
  - `ChatStatusBar.tsx`: ストリーミング中インジケータ「Claude が作業中...」 / エラー / 停止ボタン
  - **`ToolUseCard.tsx` は MVP 範囲外**（Phase 4 評価後に追加判断）
- ペインヘッダー（`TerminalSubHeader.tsx`）に Chat タブを追加（CLI / MD / Chat）

### 3.6 認証フロー

- 初回起動時 claude CLI 自体が OAuth ブラウザフローを発火する（未認証時）。terminal-division はその挙動に介入しない
- 未認証検出時の UX: stream-json モードでは認証が必要なら stderr / 終了コードで示される想定 → `chat:event` の `error` で UI に「`claude /login` を CLI モードで実行してください」と案内
- これは Phase 0 で実機確認

---

## Steps

### Phase 0: 事前検証（着手判断）

- [ ] **0-1.** `claude --output-format stream-json --input-format stream-json` の実機検証
  - 入出力 JSONL のスキーマ調査（`type`, `subtype`, `delta`, `tool_use_id`, `session_id`, ...）
  - 1 セッション内で複数ターンの対話が可能か（双方向ストリーミング）
  - 終了条件（最終 `end` イベントの有無）
  - 未認証時の振る舞い（stderr / exit code / event 種別）
- [ ] **0-2.** **会話継続フローの検証**（Q2 採用に伴い critical）
  - `claude --resume <session-id>` の動作確認（履歴ロード後そのまま対話継続できるか）
  - session-id の取得経路: stream-json イベント / `~/.claude/sessions/` 等のファイル / 環境変数 / OSC のいずれか
  - PTY 側 TUI でも同 session-id で `--resume` できるか
- [ ] **0-3.** **自動検出方式の検証**（Q1 採用に伴い critical）
  - claude CLI 起動時に固有 ANSI / OSC が出るか（出力ストリーム解析で十分か）
  - 出ない場合: macOS での `tcgetpgrp(ptyFd)` + `ps` 方式の妥当性とパフォーマンス計測（500ms ポーリングで CPU 影響）
- [ ] **0-4.** ツール承認プロンプトの扱い検証（`--allowedTools` / `--dangerously-skip-permissions` の影響）。stream-json で承認待ちはどうイベント化されるか
- [ ] **0-5.** 検証結果を `.claude/docs/known-issues/003-claude-cli-stream-json.md` に記録（Phase 1 設計の根拠資料）
- [ ] **0-6.** 検証で **stream-json 不可** または **`--resume` 不可** が判明した場合、Q3 fallback 戦略（one-shot per-turn / TUI screen-scrape）でユーザー再合意を取る

### Phase 1: 基盤（IPC + Main プロセス）

- [ ] **1-1.** `src/main/chat-session-manager.ts` 新規作成（`ChatSession` 構造体、spawn / write / stop / dispose / getSessionId、`--resume` 対応）
- [ ] **1-2.** stream-json パーサー: 行バッファリング + 不完全 JSON ハンドリング + session_id 抽出
- [ ] **1-3.** `src/main/claude-process-detector.ts` 新規作成（PTY 出力監視 + foreground プロセス確認）
- [ ] **1-4.** `src/main/ipc-handlers.ts` に `chat:start` / `chat:send` / `chat:stop` / `chat:dispose` / `chat:getSessionId` 追加
- [ ] **1-5.** Main → Renderer push イベント: `chat:event` / `chat:claudeDetected`
- [ ] **1-6.** `src/preload/index.ts` + `index.d.ts` に `window.api.chat.*` 公開
- [ ] **1-7.** claude バイナリ解決を `src/main/cli-resolver.ts` に共通化（既存 PTY からの抽出）
- [ ] **1-8.** `src/main/pty-manager.ts`: 出力 chunk を detector へ渡す配線（既存 PTY data flow に hook 追加）

### Phase 2: Renderer State + メッセージモデル

- [ ] **2-1.** `src/renderer/types/chat.ts`: `ChatMessage` / `ToolUse` / `ToolResult` 型定義（ToolUse/Result は将来用に保持、UI 描画はしない）
- [ ] **2-2.** `src/renderer/stores/chatSessionStore.ts`: Zustand ストア + アクション + テスト（`sessionId` 管理含む）
- [ ] **2-3.** `terminalMetaStore` の `viewMode` 拡張（`"cli" | "md" | "chat"`）+ アクション + テスト
- [ ] **2-4.** `src/renderer/services/chatBridge.ts`: `window.api.chat.*` ↔ store の橋渡し（IPC イベント subscribe / 入力送出）
- [ ] **2-5.** **claude 検出ハンドラ**: `chat:claudeDetected` 受信 → `viewMode="chat"` 切替 + `chat:start({ resumeSessionId })` 自動発火
- [ ] **2-6.** **CLI 戻り時のセッション継続**: `viewMode` を `chat` → `cli` に戻す際、`chat:getSessionId` で取得した id を `pty:create` の引数（`initialCommand: "claude --resume <id>"`）に渡す配線

### Phase 3: UI コンポーネント

- [ ] **3-1.** `ChatPaneView.tsx`: コンテナ + ライフサイクル（mount で `chat:start`、unmount は dispose しない＝ MD と同じ）
- [ ] **3-2.** `MessageList.tsx`: 自動スクロール（最下部追従、ユーザーが上にスクロール中は固定）
- [ ] **3-3.** `MessageBubble.tsx`: User / Assistant 識別、Markdown 表示、コードブロックハイライト
- [ ] **3-4.** `ChatInput.tsx`:
  - 1〜3 行 自動高さ拡張、4 行以上は固定 `max-height` + 内部スクロール
  - Enter / Shift+Enter / Cmd+Enter、IME ガード、送信中は disable
  - 入力値長 64KB を超えたら警告表示（送信は許容、ただし計測ログを `console.warn`）
- [ ] **3-5.** `ChatStatusBar.tsx`: streaming インジケータ「Claude が作業中...」 + 停止ボタン + エラー表示
- [ ] **3-6.** `TerminalSubHeader.tsx`: タブ群（CLI / MD / Chat）に拡張、現在タブのスタイル
- [ ] **3-7.** **パフォーマンス計測**: 64KB 入力 + 大量メッセージ（100 件）で描画フレームレートを計測。劣化があれば `MessageList` の仮想化を Phase 3 内で追加判断
- [ ] **3-8.** **UI/UX 評価セッション**: ユーザーと一緒に MVP 実機確認 → ツール表示の必要性（Q4 再判断）と Phase 4 スコープ確定

### Phase 4: 統合 + ショートカット + ガード

- [ ] **4-1.** `App.tsx`: capture-phase keydown で Chat フォーカス時はターミナルショートカットを抑制（MD と同じパターン）
- [ ] **4-2.** Chat 入力中の Cmd+W: PTY 破棄ではなくモーダル確認（streaming 中なら停止確認）
- [ ] **4-3.** ショートカットモーダル（`ShortcutsModal.tsx`）に Chat 系ショートカット追記
- [ ] **4-4.** ペイン分割時 / close 時に chat session を dispose
- [ ] **4-5.** 認証エラー時の UI: 「CLI モードで `claude /login` を実行してください」リンク（CLI タブにフォーカス遷移ボタン）
- [ ] **4-6.** **Q4 再判断後**（必要なら）: `ToolUseCard.tsx` 実装 + MessageList への組み込み
- [ ] **4-7.** 自動切替の suppress オプション（Settings に「`claude` 起動時に自動で Chat ビューに切り替える」トグル）
- [ ] **4-8.** Phase 0 で確定した自動検出方式の精度向上（誤検出時の fallback）

### Phase 5: 仕上げ + ドキュメント

- [ ] **5-1.** `CLAUDE.md` §3 Architecture に「3.9 Chat Session Manager」追加
- [ ] **5-2.** `CLAUDE.md` §8 Feature Tier Map に **T2-11**（または T3-5）として追記
- [ ] **5-3.** `docs/requirements/tier-2-supporting.md`（または tier-3-experimental）に詳細追記
- [ ] **5-4.** `docs/code-explanation/06-chat-session.md` 新規（学習教材）
- [ ] **5-5.** README にセクション追加（前提: claude CLI が PATH に存在 + ログイン済）

---

## Files

| File                                                      | Operation         | Notes                                                    |
| --------------------------------------------------------- | ----------------- | -------------------------------------------------------- |
| `src/main/chat-session-manager.ts`                        | **new**           | 子プロセス spawn / stdin/stdout 管理 / `--resume` 対応   |
| `src/main/claude-process-detector.ts`                     | **new**           | PTY 出力監視 + foreground プロセス確認で claude 起動検知 |
| `src/main/cli-resolver.ts`                                | **new**（抽出）   | claude / shell バイナリ解決の共通ロジック                |
| `src/main/pty-manager.ts`                                 | modify            | 出力 chunk を detector へ流す hook 追加                  |
| `src/main/ipc-handlers.ts`                                | modify            | `chat:*` IPC ハンドラ追加                                |
| `src/preload/index.ts`                                    | modify            | `window.api.chat.*` 公開                                 |
| `src/preload/index.d.ts`                                  | modify            | 型定義                                                   |
| `src/renderer/types/chat.ts`                              | **new**           | ChatMessage / ToolUse 型                                 |
| `src/renderer/stores/chatSessionStore.ts`                 | **new**           | Zustand chat ストア                                      |
| `src/renderer/stores/__tests__/chatSessionStore.test.ts`  | **new**           | ストアテスト                                             |
| `src/renderer/stores/terminalMetaStore.ts`                | modify            | `viewMode` に `"chat"` 追加                              |
| `src/renderer/services/chatBridge.ts`                     | **new**           | IPC ↔ store ブリッジ                                     |
| `src/renderer/components/ChatPane/ChatPaneView.tsx`       | **new**           | コンテナ                                                 |
| `src/renderer/components/ChatPane/MessageList.tsx`        | **new**           | メッセージリスト                                         |
| `src/renderer/components/ChatPane/MessageBubble.tsx`      | **new**           | User / Assistant バブル                                  |
| `src/renderer/components/ChatPane/ToolUseCard.tsx`        | **new** (Phase 4) | ツール表示（MVP 範囲外、Q4 再判断後）                    |
| `src/renderer/components/ChatPane/ChatInput.tsx`          | **new**           | 入力欄（1〜3 行自動拡張、4 行以上スクロール）            |
| `src/renderer/components/ChatPane/ChatStatusBar.tsx`      | **new**           | ステータス + 停止                                        |
| `src/renderer/components/ChatPane/__tests__/*.test.tsx`   | **new**           | UI テスト                                                |
| `src/renderer/components/TerminalSubHeader.tsx`           | modify            | Chat タブ追加                                            |
| `src/renderer/components/SplitContainer.tsx`              | modify            | viewMode 分岐に "chat" を追加                            |
| `src/renderer/App.tsx`                                    | modify            | capture-phase ショートカットの Chat ガード               |
| `src/renderer/shortcuts/registry.ts`                      | modify            | chat 系（必要なら）                                      |
| `package.json`                                            | modify            | `react-markdown`（または既存資産で済むか検討）追加判断   |
| `.claude/docs/known-issues/003-claude-cli-stream-json.md` | **new**           | Phase 0 検証ログ                                         |
| `.claude/docs/code-explanation/06-chat-session.md`        | **new**           | 学習教材                                                 |
| `.claude/docs/requirements/tier-2-supporting.md`          | modify            | T2-11 追記（Tier 判断後）                                |
| `.claude/CLAUDE.md`                                       | modify            | §3 / §8 更新                                             |

---

## Verification

### 機能受入

- [ ] **PTY で `claude` を実行 → 自動で Chat ビューへ切替**
- [ ] ペインヘッダーから手動でも CLI / Chat を切替できる
- [ ] ユーザー発言を送信 → アシスタント応答がストリーミングで表示される
- [ ] ストリーミング中は ChatStatusBar に「Claude が作業中...」が表示される（ツール詳細は MVP では非表示）
- [ ] **CLI ↔ Chat タブ切替後も会話セッションが継続する**（同じ session-id で `--resume`）
- [ ] CLI ↔ Chat 切替で PTY バッファ / chat メッセージ双方の状態が保持される
- [ ] 停止ボタンでストリーミングを中断できる
- [ ] 未認証時にユーザーに案内が出る（`claude /login` ガイド）
- [ ] ペイン close（Cmd+W）時に chat プロセスが確実に終了する（プロセスリーク無し）
- [ ] IME 入力中の Enter で誤送信されない
- [ ] 入力欄が 3 行までは自動拡張し、4 行以上で内部スクロールする

### 非機能

- [ ] `npm test` が通る（既存テスト破壊なし）
- [ ] `npm run build` が通る（型エラーなし）
- [ ] パッケージ版（`electron-builder --mac --dir`）でも claude バイナリが解決できる
- [ ] Anthropic API キーが `process.env` / 設定 / コードのいずれにも存在しない（grep 確認）
- [ ] **入力欄 64KB + メッセージ 100 件で操作レスポンスが顕著に劣化しない**（Phase 3-7 で計測）
- [ ] **claude 自動検出のポーリング（500ms）で CPU 占有が顕著にならない**（Phase 0-3 で計測、上限目安 1% / アイドル時）

### Known Issue 監視

- [ ] stream-json プロトコルの破壊的変更に対する fallback / バージョン警告
- [ ] claude CLI 未インストール / 古バージョン時のエラー文言
- [ ] `--resume` の session-id 不一致 / セッション喪失時の挙動

---

## 関連ドキュメント

- 設計原則: [`docs/vision/coding-principles.md`](./docs/vision/coding-principles.md)
- 既存 viewMode 拡張パターン: [`archive/2026-04-26-markdown-editor.md`](./archive/2026-04-26-markdown-editor.md)
- Tier Map: [`CLAUDE.md`](./CLAUDE.md) §8

---

## 次アクション

1. ✅ Open Questions Q1〜Q5 確定（2026-04-29）
2. **Phase 0** に着手 → claude CLI stream-json / `--resume` / 自動検出の実機検証
3. Phase 0 結果を `docs/known-issues/003-claude-cli-stream-json.md` に記録 → スコープ確定
4. `task-tracker` で MEMORY.md に T3-5（候補）として登録
5. Phase 1〜5 を順次実装、Phase 3 完了時点で UI/UX 評価セッション → Phase 4 スコープ確定
