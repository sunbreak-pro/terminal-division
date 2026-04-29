import { describe, it, expect, beforeEach } from "vitest";
import { useChatSessionStore } from "../chatSessionStore";
import type { ChatToolUse } from "../../types/chat";

function reset(): void {
  useChatSessionStore.setState({ sessions: new Map() });
}

describe("chatSessionStore", () => {
  beforeEach(reset);

  describe("getOrCreate / remove", () => {
    it("creates an empty state on first call and reuses on second", () => {
      const a = useChatSessionStore.getState().getOrCreate("p1");
      const b = useChatSessionStore.getState().getOrCreate("p1");
      expect(a.status).toBe("idle");
      expect(a.messages).toEqual([]);
      // 同じ entry を返す（参照同一性は保証されないが内容は同じ）
      expect(b.status).toBe("idle");
      expect(useChatSessionStore.getState().sessions.size).toBe(1);
    });

    it("remove deletes the pane entry", () => {
      useChatSessionStore.getState().getOrCreate("p1");
      useChatSessionStore.getState().remove("p1");
      expect(useChatSessionStore.getState().sessions.has("p1")).toBe(false);
    });
  });

  describe("appendUserMessage", () => {
    it("appends a user message with role=user and status=completed", () => {
      useChatSessionStore.getState().appendUserMessage("p1", "hello");
      const s = useChatSessionStore.getState().sessions.get("p1");
      expect(s?.messages.length).toBe(1);
      expect(s?.messages[0].role).toBe("user");
      expect(s?.messages[0].text).toBe("hello");
      expect(s?.messages[0].status).toBe("completed");
    });
  });

  describe("assistant streaming", () => {
    it("beginAssistantMessage sets currentMessageId and status=streaming", () => {
      useChatSessionStore.getState().beginAssistantMessage("p1", "msg_1");
      const s = useChatSessionStore.getState().sessions.get("p1");
      expect(s?.currentMessageId).toBe("msg_1");
      expect(s?.status).toBe("streaming");
      expect(s?.currentAssistantBuffer).toBe("");
    });

    it("appendAssistantDelta concatenates into currentAssistantBuffer", () => {
      const store = useChatSessionStore.getState();
      store.beginAssistantMessage("p1", "msg_1");
      store.appendAssistantDelta("p1", "Hello ");
      store.appendAssistantDelta("p1", "world");
      const s = useChatSessionStore.getState().sessions.get("p1");
      expect(s?.currentAssistantBuffer).toBe("Hello world");
    });

    it("finalize with text creates assistant message and clears buffer", () => {
      const store = useChatSessionStore.getState();
      store.beginAssistantMessage("p1", "msg_1");
      store.appendAssistantDelta("p1", "answer");
      store.finalizeAssistantMessage("p1");
      const s = useChatSessionStore.getState().sessions.get("p1");
      expect(s?.messages.length).toBe(1);
      expect(s?.messages[0].text).toBe("answer");
      expect(s?.messages[0].role).toBe("assistant");
      expect(s?.messages[0].status).toBe("completed");
      expect(s?.currentAssistantBuffer).toBe("");
      expect(s?.currentMessageId).toBeNull();
    });

    it("finalize with empty content + no toolUses skips message creation (empty bubble suppression)", () => {
      const store = useChatSessionStore.getState();
      store.beginAssistantMessage("p1", "msg_1");
      // delta なし、tool 無し
      store.finalizeAssistantMessage("p1");
      const s = useChatSessionStore.getState().sessions.get("p1");
      expect(s?.messages.length).toBe(0);
      expect(s?.currentAssistantBuffer).toBe("");
      expect(s?.currentMessageId).toBeNull();
      expect(s?.currentActivity).toBeNull();
    });

    it("finalize with tool_uses but empty text creates a bubble (so tool cards are visible)", () => {
      const store = useChatSessionStore.getState();
      store.beginAssistantMessage("p1", "msg_1");
      const tool: ChatToolUse = {
        id: "t1",
        name: "Bash",
        input: { command: "echo hi" },
        resultText: null,
        resultIsError: false,
      };
      store.finalizeAssistantMessage("p1", [tool]);
      const s = useChatSessionStore.getState().sessions.get("p1");
      expect(s?.messages.length).toBe(1);
      expect(s?.messages[0].toolUses.length).toBe(1);
      expect(s?.messages[0].toolUses[0].id).toBe("t1");
    });
  });

  describe("recordToolResult", () => {
    it("updates the resultText/isError on the matching message.toolUses entry", () => {
      const store = useChatSessionStore.getState();
      const tool: ChatToolUse = {
        id: "t1",
        name: "Bash",
        input: {},
        resultText: null,
        resultIsError: false,
      };
      store.beginAssistantMessage("p1", "msg_1");
      store.appendAssistantDelta("p1", "running");
      store.finalizeAssistantMessage("p1", [tool]);
      // 後から tool_result が来た
      store.recordToolResult("p1", "t1", "HELLO123", false);
      const s = useChatSessionStore.getState().sessions.get("p1");
      const t = s?.messages[0].toolUses[0];
      expect(t?.resultText).toBe("HELLO123");
      expect(t?.resultIsError).toBe(false);
    });

    it("marks isError=true correctly", () => {
      const store = useChatSessionStore.getState();
      const tool: ChatToolUse = {
        id: "t2",
        name: "Bash",
        input: {},
        resultText: null,
        resultIsError: false,
      };
      store.beginAssistantMessage("p1", "msg_1");
      store.appendAssistantDelta("p1", "x");
      store.finalizeAssistantMessage("p1", [tool]);
      store.recordToolResult("p1", "t2", "err: bad", true);
      const t = useChatSessionStore.getState().sessions.get("p1")?.messages[0]
        .toolUses[0];
      expect(t?.resultIsError).toBe(true);
    });

    it("is no-op when tool_use_id does not match any message", () => {
      const store = useChatSessionStore.getState();
      store.beginAssistantMessage("p1", "msg_1");
      store.appendAssistantDelta("p1", "answer");
      store.finalizeAssistantMessage("p1");
      // 該当 id 無し → 何も起きない
      store.recordToolResult("p1", "nonexistent", "x", false);
      const s = useChatSessionStore.getState().sessions.get("p1");
      expect(s?.messages[0].toolUses).toEqual([]);
    });
  });

  describe("setActivity", () => {
    it("sets and clears currentActivity", () => {
      const store = useChatSessionStore.getState();
      store.getOrCreate("p1");
      store.setActivity("p1", { kind: "thinking" });
      expect(
        useChatSessionStore.getState().sessions.get("p1")?.currentActivity,
      ).toEqual({ kind: "thinking" });
      store.setActivity("p1", null);
      expect(
        useChatSessionStore.getState().sessions.get("p1")?.currentActivity,
      ).toBeNull();
    });
  });

  describe("setStatus / setSessionId / setError", () => {
    it("updates status / sessionId / lastError independently", () => {
      const store = useChatSessionStore.getState();
      store.getOrCreate("p1");
      store.setStatus("p1", "starting");
      store.setSessionId("p1", "uuid-1");
      store.setError("p1", "boom");
      const s = useChatSessionStore.getState().sessions.get("p1");
      expect(s?.status).toBe("starting");
      expect(s?.sessionId).toBe("uuid-1");
      expect(s?.lastError).toBe("boom");
    });
  });
});
