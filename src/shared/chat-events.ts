// Main → Renderer に流す chat:event の中身。chat-session-manager.ts と preload/index.ts と
// renderer/services/chatBridge.ts の 3 箇所で型参照するため shared に置く。
//
// payload の中身は claude CLI の stream-json スキーマに従う（src/shared/chat-events に詳細はないので、
// docs/known-issues/003-claude-cli-stream-json.md を参照）。Renderer 側では Record<string, unknown>
// として受け取り、必要なフィールドだけ defensive に抽出する方針。

export type ChatEventEnvelope =
  | { type: "system"; payload: Record<string, unknown> }
  | { type: "assistant"; payload: Record<string, unknown> }
  | { type: "user"; payload: Record<string, unknown> }
  | { type: "stream"; payload: Record<string, unknown> }
  | { type: "result"; payload: Record<string, unknown> }
  | { type: "rate_limit"; payload: Record<string, unknown> }
  | { type: "session.id"; sessionId: string }
  | {
      type: "error";
      message: string;
      payload?: Record<string, unknown>;
    }
  | { type: "end"; exitCode: number | null };
