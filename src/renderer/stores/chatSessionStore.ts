import { create } from "zustand";
import type {
  ChatActivity,
  ChatMessage,
  ChatState,
  ChatStatus,
  ChatToolUse,
} from "../types/chat";

interface ChatSessionStore {
  sessions: Map<string, ChatState>;

  // 取得 / 作成
  getOrCreate: (paneId: string) => ChatState;
  reset: (paneId: string) => void;
  remove: (paneId: string) => void;

  // ステータス
  setStatus: (paneId: string, status: ChatStatus) => void;
  setSessionId: (paneId: string, sessionId: string | null) => void;
  setError: (paneId: string, message: string | null) => void;

  // メッセージ追加（ユーザー入力）
  appendUserMessage: (paneId: string, text: string) => void;

  // assistant streaming
  beginAssistantMessage: (paneId: string, messageId: string | null) => void;
  appendAssistantDelta: (paneId: string, delta: string) => void;
  appendThinkingDelta: (paneId: string, delta: string) => void;
  // toolUses はこの assistant message が使用したツール（tool_use ブロック）の配列。
  // 完了時にメッセージへ紐付け、後から来る tool_result を recordToolResult で同 message に注入する。
  finalizeAssistantMessage: (paneId: string, toolUses?: ChatToolUse[]) => void;

  // 進行中の作業表示（ChatStatusBar が表示する）
  setActivity: (paneId: string, activity: ChatActivity | null) => void;

  // ツール使用
  recordToolUse: (paneId: string, tool: ChatToolUse) => void;
  recordToolResult: (
    paneId: string,
    toolUseId: string,
    resultText: string,
    isError: boolean,
  ) => void;
}

const FALLBACK_PREFIX = "msg_local_";
let fallbackCounter = 0;
function nextFallbackId(): string {
  fallbackCounter += 1;
  return `${FALLBACK_PREFIX}${Date.now()}_${fallbackCounter}`;
}

function emptyState(): ChatState {
  return {
    sessionId: null,
    status: "idle",
    messages: [],
    currentAssistantBuffer: "",
    currentThinkingBuffer: null,
    currentMessageId: null,
    currentActivity: null,
    pendingToolUses: new Map(),
    lastError: null,
  };
}

export const useChatSessionStore = create<ChatSessionStore>((set, get) => {
  // 共通: 該当ペインの ChatState を mutate する。Map は新しい参照に差し替え、
  // ChatState 自体も新オブジェクトに差し替えて React の再レンダリングを起こす。
  const updateState = (
    paneId: string,
    mutate: (state: ChatState) => ChatState,
  ): void => {
    const sessions = new Map(get().sessions);
    const current = sessions.get(paneId) ?? emptyState();
    sessions.set(paneId, mutate(current));
    set({ sessions });
  };

  return {
    sessions: new Map(),

    getOrCreate: (paneId) => {
      const existing = get().sessions.get(paneId);
      if (existing) return existing;
      const fresh = emptyState();
      const sessions = new Map(get().sessions);
      sessions.set(paneId, fresh);
      set({ sessions });
      return fresh;
    },

    reset: (paneId) => {
      updateState(paneId, () => emptyState());
    },

    remove: (paneId) => {
      const sessions = new Map(get().sessions);
      sessions.delete(paneId);
      set({ sessions });
    },

    setStatus: (paneId, status) => {
      updateState(paneId, (s) => ({ ...s, status }));
    },

    setSessionId: (paneId, sessionId) => {
      updateState(paneId, (s) => ({ ...s, sessionId }));
    },

    setError: (paneId, message) => {
      updateState(paneId, (s) => ({ ...s, lastError: message }));
    },

    appendUserMessage: (paneId, text) => {
      const msg: ChatMessage = {
        id: nextFallbackId(),
        role: "user",
        text,
        thinking: null,
        toolUses: [],
        receivedAt: Date.now(),
        status: "completed",
        errorMessage: null,
      };
      updateState(paneId, (s) => ({
        ...s,
        messages: [...s.messages, msg],
      }));
    },

    beginAssistantMessage: (paneId, messageId) => {
      updateState(paneId, (s) => ({
        ...s,
        currentMessageId: messageId ?? nextFallbackId(),
        currentAssistantBuffer: "",
        currentThinkingBuffer: null,
        status: "streaming",
      }));
    },

    appendAssistantDelta: (paneId, delta) => {
      if (!delta) return;
      updateState(paneId, (s) => ({
        ...s,
        currentAssistantBuffer: s.currentAssistantBuffer + delta,
      }));
    },

    appendThinkingDelta: (paneId, delta) => {
      if (!delta) return;
      updateState(paneId, (s) => ({
        ...s,
        currentThinkingBuffer: (s.currentThinkingBuffer ?? "") + delta,
      }));
    },

    finalizeAssistantMessage: (paneId, toolUses) => {
      updateState(paneId, (s) => {
        const text = s.currentAssistantBuffer;
        const thinking = s.currentThinkingBuffer;
        const newToolUses = toolUses ?? [];
        // 直近の assistant メッセージが同 id で既に存在するなら上書き、なければ追加
        const messageId = s.currentMessageId ?? nextFallbackId();
        const lastIndex = s.messages.length - 1;
        const lastMsg = lastIndex >= 0 ? s.messages[lastIndex] : null;
        const existingPending =
          lastMsg && lastMsg.role === "assistant" && lastMsg.id === messageId
            ? lastMsg
            : null;

        // text も thinking も tool_use も無いなら、空 bubble を作らない
        // （assistant が空のチャンクで来た稀なケースを抑止）。
        const hasContent =
          text.length > 0 ||
          (thinking !== null && thinking.length > 0) ||
          newToolUses.length > 0 ||
          (existingPending &&
            (existingPending.text.length > 0 ||
              existingPending.toolUses.length > 0));

        if (!hasContent && !existingPending) {
          return {
            ...s,
            currentAssistantBuffer: "",
            currentThinkingBuffer: null,
            currentMessageId: null,
            currentActivity: null,
          };
        }

        const finalized: ChatMessage = existingPending
          ? {
              ...existingPending,
              text: existingPending.text + text,
              thinking: thinking ?? existingPending.thinking,
              toolUses: [...existingPending.toolUses, ...newToolUses],
              status: "completed",
            }
          : {
              id: messageId,
              role: "assistant",
              text,
              thinking,
              toolUses: newToolUses,
              receivedAt: Date.now(),
              status: "completed",
              errorMessage: null,
            };
        const messages = existingPending
          ? [...s.messages.slice(0, lastIndex), finalized]
          : [...s.messages, finalized];
        return {
          ...s,
          messages,
          currentAssistantBuffer: "",
          currentThinkingBuffer: null,
          currentMessageId: null,
          currentActivity: null,
        };
      });
    },

    setActivity: (paneId, activity) => {
      updateState(paneId, (s) => ({ ...s, currentActivity: activity }));
    },

    recordToolUse: (paneId, tool) => {
      updateState(paneId, (s) => {
        const pending = new Map(s.pendingToolUses);
        pending.set(tool.id, tool);
        return { ...s, pendingToolUses: pending };
      });
    },

    recordToolResult: (paneId, toolUseId, resultText, isError) => {
      updateState(paneId, (s) => {
        // pendingToolUses（生レコード）も更新しつつ、確定済み messages に紐づく
        // toolUses も同一 id を見つけて結果を反映する。
        const pending = new Map(s.pendingToolUses);
        const prev = pending.get(toolUseId);
        if (prev) {
          pending.set(toolUseId, {
            ...prev,
            resultText,
            resultIsError: isError,
          });
        }
        // 該当 message を更新。多くの場合は最新の assistant メッセージなので末尾から探す。
        let updatedMessages: ChatMessage[] = s.messages;
        for (let i = s.messages.length - 1; i >= 0; i--) {
          const m = s.messages[i];
          if (m.role !== "assistant") continue;
          const idx = m.toolUses.findIndex((t) => t.id === toolUseId);
          if (idx === -1) continue;
          const newTools = m.toolUses.slice();
          newTools[idx] = {
            ...newTools[idx],
            resultText,
            resultIsError: isError,
          };
          updatedMessages = [
            ...s.messages.slice(0, i),
            { ...m, toolUses: newTools },
            ...s.messages.slice(i + 1),
          ];
          break;
        }
        return {
          ...s,
          pendingToolUses: pending,
          messages: updatedMessages,
        };
      });
    },
  };
});

// セレクター
export function useChatState(paneId: string): ChatState | undefined {
  return useChatSessionStore((s) => s.sessions.get(paneId));
}
