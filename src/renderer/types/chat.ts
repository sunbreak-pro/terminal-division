// チャット UI が描画する高レベルメッセージ型。
// stream-json で来る生イベント（assistant / user with tool_result / stream_event 等）を
// Renderer 側で正規化し、UI で扱いやすい形に集約する。

export type ChatRole = "user" | "assistant" | "system";

// ツール使用ブロック（Phase 4 評価用に store には保存するが MVP では UI に描画しない）
export interface ChatToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
  // 対応する tool_result。未着なら null。
  resultText: string | null;
  resultIsError: boolean;
}

// アシスタント発言の中身は text と tool_use の混合。MVP では text を結合して 1 つの本文として扱う。
// 将来 ToolUseCard を入れるときは toolUses[] を順序保持してインライン描画する。
export interface ChatMessage {
  id: string; // claude が emit する message id (msg_xxx) または client 側で fallback uuid
  role: ChatRole;
  // 確定済みのテキスト（streaming 中は currentAssistantBuffer 側に保持）
  text: string;
  // 思考ブロック（Phase 4 で表示判断）
  thinking: string | null;
  toolUses: ChatToolUse[];
  // 受信完了タイムスタンプ
  receivedAt: number;
  // streaming → completed → error の状態
  status: "streaming" | "completed" | "error";
  // エラー時のメッセージ（status=error 時のみ）
  errorMessage: string | null;
}

export type ChatStatus = "idle" | "starting" | "streaming" | "error" | "ended";

// 現在の作業工程。content_block_start で設定、content_block_stop でクリア。
// ChatStatusBar が「Bash を実行中: echo HELLO」のように表示する。
export type ChatActivity =
  | { kind: "thinking" }
  | { kind: "text" } // 通常の応答テキストを書いている最中
  | { kind: "tool_use"; toolName: string; description: string | null };

export interface ChatState {
  // claude CLI の session_id。Chat ↔ CLI 切替で `--resume` 引数として使う。
  sessionId: string | null;
  status: ChatStatus;
  messages: ChatMessage[];
  // 直近のアシスタント発言を streaming 中に蓄積するバッファ（content_block_delta の append 先）
  currentAssistantBuffer: string;
  currentThinkingBuffer: string | null;
  // 現在 streaming 中のメッセージ id（assistant が append される対象）
  currentMessageId: string | null;
  // 現在進行中の作業（thinking / tool_use / 通常テキスト）。
  // content_block_start で設定、content_block_stop で null に戻す。
  currentActivity: ChatActivity | null;
  // 未処理のツール使用（tool_use_id をキーに finalize 待ち）
  pendingToolUses: Map<string, ChatToolUse>;
  // 最後に受信したエラー（system バーに表示）
  lastError: string | null;
}
