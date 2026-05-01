# 003: Claude CLI stream-json プロトコル仕様 (Phase 0 検証ログ)

**Status**: Withdrawn (2026-05-02 — Chat UI 機能ごと撤回。subscription redistribution リスクのため。詳細は `.claude/archive/2026-04-29-claude-code-chat-ui.md` の Withdrawn 注記参照)
**Discovered**: 2026-04-29（Phase 0 事前検証）
**Resolved**: -
**Related**: `.claude/archive/2026-04-29-claude-code-chat-ui.md` (T3-5 / Withdrawn)

---

## Symptoms

T3-5（Claude Code Chat UI in Pane）の MVP は外部 `claude` CLI を子プロセス起動し、`--input-format stream-json --output-format stream-json` で双方向 JSONL を流す前提に立つ。CLI のフラグ仕様・JSONL スキーマ・認証フォールバックの挙動はドキュメント化されておらず、実機検証なしに実装に着手すると Phase 1 で再設計が発生するリスクがある。

## Root Cause

`claude` CLI v2.1.123 の `-p` (`--print`) モード + `--input-format stream-json` + `--output-format stream-json` は実装上 Anthropic Messages API の SSE と同等のスキーマを emit する。CLI ヘルプには概要しか書かれておらず、詳細は実機呼び出しで確認するしかない。本 issue は **「stream-json プロトコルがいつか破壊的に変わるリスク」** を Monitoring 対象として記録し、実装が依存している前提を文書化することで再発防止 / 検出を容易にする。

## 検証結果（Phase 0 - 2026-04-29）

### 環境

- claude CLI: `/Users/newlife/.local/bin/claude` v2.1.123 (Claude Code)
- 認証: OAuth (Claude Max サブスク) — `apiKeySource: "none"` で動作
- 検証 OS: macOS (Darwin 25.2.0)

### F1. `--input/--output-format stream-json` は **`--print` 必須**

CLI ヘルプ:

- `--input-format <format>`: `"text" | "stream-json"` — only works with `--print`
- `--output-format <format>`: `"text" | "json" | "stream-json"` — only works with `--print`
- `--include-partial-messages`: only works with `--print` and `--output-format=stream-json`
- `--include-hook-events`: only works with `--output-format=stream-json`
- `--replay-user-messages`: input-format=stream-json + output-format=stream-json でのみ動作

`-p` は本来 "Print response and exit" だが、後述 F3 のとおり stream-json input ではプロセスを保持して複数ターンを処理する。

### F2. 出力 JSONL の type / subtype（`--verbose --output-format stream-json` 時）

通常モード（hook 有効）で出現する `type`:

| type               | subtype                                            | 用途                                                                                                                           |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `system`           | `init`                                             | 起動時 1 回。`session_id` / `cwd` / `tools` / `model` / `apiKeySource` / `permissionMode` / `slash_commands` / `agents` を含む |
| `system`           | `hook_started` / `hook_progress` / `hook_response` | Session hook 実行ログ（terminal-division では基本不要、無視可）                                                                |
| `system`           | `status`                                           | (内部状態通知)                                                                                                                 |
| `assistant`        | -                                                  | アシスタント応答。`message.content[]` に `text` / `tool_use` / `thinking` ブロック                                             |
| `user`             | -                                                  | claude が自動生成する system 側 user メッセージ。`message.content[]` に `tool_result` ブロック                                 |
| `stream_event`     | -                                                  | `--include-partial-messages` 指定時のみ。SSE 同等 (下表)                                                                       |
| `result`           | `success`                                          | ターン終了時。`session_id` / `total_cost_usd` / `usage` / `is_error` / `result` (テキスト) / `permission_denials[]`            |
| `rate_limit_event` | -                                                  | レート制限近接時の警告                                                                                                         |
| `message` / `text` | -                                                  | 旧スキーマ互換 (現行モードでは未観測。要監視)                                                                                  |

#### `assistant.message.content[]` のブロック型

```jsonc
// テキスト応答
{ "type": "text", "text": "..." }

// ツール使用
{ "type": "tool_use", "id": "...", "name": "Bash", "input": { "command": "...", "description": "..." } }

// 思考（Phase 4 評価対象。MVP では非表示）
{ "type": "thinking", ... }
```

#### `user.message.content[]` の `tool_result`

```jsonc
{
  "type": "tool_result",
  "tool_use_id": "...",
  "content": "HELLO123", // string or [{ type:"text", text:"..." }]
  "is_error": false,
}
```

### F3. `--include-partial-messages` の SSE 互換イベント

`stream_event.event.type` の系列（Anthropic Messages SSE と同一）:

| event.type            | 意味                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `message_start`       | 新メッセージ開始（usage / model 含む）                                                                                          |
| `content_block_start` | ブロック (text / tool_use) 開始                                                                                                 |
| `content_block_delta` | デルタ。`delta.type=text_delta` の `delta.text` を逐次連結すれば最終テキストになる。tool 入力中は `delta.type=input_json_delta` |
| `content_block_stop`  | ブロック終了                                                                                                                    |
| `message_delta`       | `stop_reason` / 累積 usage の更新                                                                                               |
| `message_stop`        | メッセージ終了                                                                                                                  |

**チャット UI のストリーミング描画は `content_block_delta` の `text_delta.text` を逐次 `currentAssistantBuffer` に append する**ので十分。`content_block_stop` で append を確定し、`assistant`（または次の `result`）を受けて確定済みメッセージとしてストアに格納する。

### F4. 入力 JSONL のスキーマ

確認できた入力フォーマット:

```jsonc
{
  "type": "user",
  "message": { "role": "user", "content": [{ "type": "text", "text": "..." }] },
}
```

stdin に行区切り (`\n`) で書き込む。**1 プロセスを保持したまま複数ターンを送信できる** ことを実機で確認（後述 F5）。

### F5. `--session-id <uuid>` + `--input-format stream-json` で 1 プロセス内マルチターン成立 ✅

検証手順:

1. `uuidgen` で生成した UUID を `--session-id` に渡し `--input-format stream-json --output-format stream-json` で起動
2. stdin に「42 を覚えて」JSONL を送信 → "OK" 応答 + `result` イベント (session_id 一致)
3. 続けて同 stdin に「何の数字?」JSONL を送信 → "42" 応答 (会話履歴を保持) + `result` イベント

**観測**:

- 両 `result` イベントの `session_id` は完全一致
- 2 ターン目の `cache_read_input_tokens` は 1 ターン目から大幅増加 (`18344 → 41718`) でコンテキストキャッシュ効果を確認
- 2 ターン目の `total_cost_usd` は 1 ターン目の約 1/8（cache hit による削減）
- stdin を close するとプロセスは自然終了

つまり **「1 プロセス保持型 + 双方向 stream-json」** がプランの第一案どおり成立。Phase 0 fallback (one-shot per-turn) は実装不要 ✅

### F6. `--resume <session-id>` での再開

別プロセスで `--resume <session-id>` を渡すと履歴ロード後に対話を継続できる。`--print` で 1 ターン送る場合も、`--input-format stream-json` で複数ターン送る場合も同一 session_id で接続可能。

**実装含意**:

- Chat 起動時: 新規なら `--session-id <uuid>` 、PTY からの引継ぎなら `--resume <id>` を渡す
- Chat → CLI 戻り時: `chat:getSessionId` で取得した id を `claude --resume <id>` として PTY 起動引数に組み込めば TUI でも履歴継続可能

### F7. PTY 上の TUI 起動マーカー（自動検出）

`script -q out claude < /dev/null` で擬似 TTY 起動 → 3 秒後に SIGTERM、出力ログを採取して以下を確認。

**最有力マーカー**: 起動直後（< 1 秒）に **OSC 0** でウィンドウタイトルを設定する:

```
ESC ] 0 ; ✳ Claude Code BEL
```

バイト列: `\x1b]0;\xe2\x9c\xb3 Claude Code\x07`

副次マーカー（信頼性低めだが裏取りに使える）:

- ASCII art の `Claude Code v2.1.123` バナー
- "Welcome back" / "auto mode on" / "/effort" のフッターテキスト

**実装案** (claude-process-detector.ts):

1. PTY 出力 chunk を流れに沿って `Boyer-Moore` 等で `\x1b]0;✳ Claude Code\x07` をストリーム検索（O(n) で十分）
2. 検出後はそのペインの監視を停止（再起動時に再開）
3. 副次として `tcgetpgrp(ptyFd)` + `ps -o comm= -p <pgrp>` の 500ms ポーリングを fallback として保持（ただしバナー方式が確実なので polling は通常起動しない）

### F8. Tool 使用イベントは `--permission-mode bypassPermissions` で承認スキップ可能

検証: `--permission-mode bypassPermissions --allowedTools "Bash(echo *)"` で `echo HELLO123` 実行を依頼

- `assistant.message.content[]` に `thinking` → `tool_use` (Bash) → 後続 `text` が並ぶ
- `user.message.content[]` に `tool_result` (`content: "HELLO123"`, `is_error: false`)
- 承認待ちダイアログは出ず即実行。`result.permission_denials` は空配列

**MVP 方針**:

- terminal-division 側からは `--permission-mode` を **デフォルト (claude CLI の既定 = "default")** で起動する。CLI 標準の承認 UI が裏で動く（誤承認防止）
- 承認待ちが stream-json でどう来るかは Phase 4 で詳細検証 (Q4 ツール表示再判断と同時)

### F9. 認証エラーは `assistant.error: "authentication_failed"` で検出可能

`--bare` モードで起動すると OAuth / keychain を読まないので認証エラーになる:

```jsonc
{
  "type": "assistant",
  "message": {
    "content": [
      { "type": "text", "text": "Not logged in · Please run /login" },
    ],
  },
  "error": "authentication_failed",
  "session_id": "...",
}
```

**実装含意**:

- `chat:event` で `assistant.error === "authentication_failed"` を検出 → `chat:event` の error イベントとして Renderer に転送
- UI 側は「CLI モードで `claude /login` を実行してください」案内（プランどおり）
- terminal-division 本体は **`--bare` を使わない**（OAuth 認証を読み込ませる必要があるため）

### F10. `--bare` は使わない

`--bare` は hook / LSP / plugin sync / **keychain reads / OAuth** をスキップする。terminal-division の Chat バックエンドは subscription 認証に依存するので **`--bare` フラグは絶対に渡さない**。代わりに hook 出力を `system.hook_*` として無視する実装にする。

---

## 設計判断（Phase 1 以降の確定方針）

| 項目                                   | 決定                                                                                                                                                            | 根拠           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| stream-json 双方向                     | **採用**（1 プロセス保持）                                                                                                                                      | F5 で実証      |
| Phase 0 fallback (one-shot per-turn)   | **不要**（Q3 fallback 戦略は撤回）                                                                                                                              | F5             |
| 起動コマンド                           | `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose --session-id <uuid>` (新規) / `... --resume <id>` (継続) | F1, F3, F5, F6 |
| `--bare`                               | **使わない**                                                                                                                                                    | F9, F10        |
| `--permission-mode`                    | **既定（指定なし）**                                                                                                                                            | F8             |
| `--allowedTools` / `--disallowedTools` | MVP では指定しない（CLI 既定承認に任せる）                                                                                                                      | F8             |
| パーサ                                 | 行単位 JSON.parse（不完全行は次 chunk と結合）                                                                                                                  | F2             |
| ストリーミング描画                     | `stream_event.event.content_block_delta.delta.text_delta.text` を逐次 append、`content_block_stop` で確定、`assistant` ブロック (final) でストア反映            | F3             |
| Tool 使用 (MVP)                        | `tool_use` / `tool_result` を store に保存するが UI には表示しない (Q4)                                                                                         | F2             |
| Thinking ブロック                      | MVP 非表示。Phase 4 で再評価                                                                                                                                    | F2             |
| 自動検出マーカー                       | OSC 0 ウィンドウタイトル `\x1b]0;✳ Claude Code\x07`                                                                                                             | F7             |
| 自動検出 fallback                      | `tcgetpgrp` + `ps` 500ms ポーリング（バナー検出の裏取り）                                                                                                       | F7             |
| 認証エラー検出                         | `assistant.error === "authentication_failed"` 即時通知                                                                                                          | F9             |
| session_id 取得経路                    | `system.init.session_id` (1 番目のイベント) と `result.session_id` 双方で取れる                                                                                 | F2             |

---

## Lessons Learned

1. **`--print` 必須フラグの罠**: `--input-format` / `--output-format` / `--include-partial-messages` は `-p` がないと無効。`-p` がないと stream-json は出ないので必ず `-p` を組み合わせる
2. **`--verbose` も実質必須**: stream-json で system/init / hook 系イベントを得るには `--verbose` が必要（指定なしだと最終 result だけ来る）
3. **`--bare` と OAuth 認証は両立しない**: `--bare` を間違って付けると `authentication_failed` で即終了。terminal-division 側のコードベースで `--bare` をハードコードしないこと
4. **stream-json の type は将来追加・変更され得る**: claude CLI のバージョン番号 (system.init.claude_code_version) を起動時に記録し、未知の type は warn して無視する設計にする（過度なエラーで UI を壊さない）
5. **OSC タイトル文字列の絵文字 (`✳`) を含む** ことに注意: バイト列マッチは UTF-8 で行う (`e2 9c b3` の 3 バイト)。文字列としては `✳ Claude Code` で grep 可能
6. **session_id は明示生成が安全**: claude CLI に `--session-id <uuid>` を渡せばクライアント側 (terminal-division) で id を保有でき、CLI ↔ Chat 連携の同期を取りやすい
7. **キャッシュ効果が明確**: 同 session_id でターンを重ねるとコストは大幅減（1/8 程度）。1 プロセス保持型のメリットはコスト面でも大きい

## 監視項目（破壊的変更検出）

実装後、定期的に以下が破壊されていないか確認する:

- `system.init.session_id` がトップレベルで取得できる
- `assistant.message.content[].type` に `text` / `tool_use` / `thinking` が存在する
- `user.message.content[].type === "tool_result"` で `tool_result` が来る
- `stream_event.event.type` の SSE 系列が変わっていない（特に `content_block_delta` の `text_delta`）
- 起動時 OSC 0 タイトル `✳ Claude Code` が出続けている
- `assistant.error` の値域に `authentication_failed` が残っている

CLI バージョンが上がって挙動が変わった場合は本ファイル末尾に「Verified against vX.Y.Z」セクションを追加して差分を記録する。

---

## References

- 関連プラン: [`.claude/2026-04-29-claude-code-chat-ui.md`](../../2026-04-29-claude-code-chat-ui.md)
- 関連設計原則: [`.claude/docs/vision/coding-principles.md`](../vision/coding-principles.md)
- claude CLI ヘルプ抜粋: 本ファイル F1-F2
- 検証コマンド例:
  ```bash
  # 1 プロセス内マルチターン
  SID=$(uuidgen | tr A-Z a-z)
  { printf '%s\n' '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}'; sleep 5; \
    printf '%s\n' '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}'; sleep 5; } \
    | claude -p --session-id "$SID" --input-format stream-json --output-format stream-json --include-partial-messages --verbose
  ```

## Verified against

- claude CLI v2.1.123 (2026-04-29)
