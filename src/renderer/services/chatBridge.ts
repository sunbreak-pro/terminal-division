import { useChatSessionStore } from "../stores/chatSessionStore";
import { useTerminalMetaStore } from "../stores/terminalMetaStore";
import type { ChatToolUse } from "../types/chat";
import type { ChatEventEnvelope } from "../../shared/chat-events";

// chatBridge は窓ごとにシングルトンとして 1 度だけ初期化する。
// React のライフサイクルから独立した IPC リスナー登録なので、
// useEffect での重複登録を避けるためグローバルなフラグで制御する。
let initialized = false;
let unsubscribers: Array<() => void> = [];

/**
 * Renderer 起動時に 1 回呼び出して、Main からの chat:event / chat:claudeDetected を
 * Zustand ストアに反映するハンドラを登録する。再呼び出しは no-op。
 */
export function initChatBridge(): void {
  if (initialized) return;
  initialized = true;

  unsubscribers.push(
    window.api.chat.onEvent(({ paneId, event }) => {
      handleChatEvent(paneId, event);
    }),
  );

  unsubscribers.push(
    window.api.chat.onClaudeDetected(({ paneId }) => {
      handleClaudeDetected(paneId);
    }),
  );
}

/**
 * テスト / HMR 用にリスナーを片付ける。通常はアプリ生存中ずっと購読しっぱなしで良い。
 */
export function disposeChatBridge(): void {
  for (const u of unsubscribers) {
    try {
      u();
    } catch {
      // ignore
    }
  }
  unsubscribers = [];
  initialized = false;
}

/**
 * ユーザー発言を送る。store にもユーザーメッセージを追加し、Main にも IPC で送信する。
 */
export function sendChatMessage(paneId: string, content: string): void {
  const store = useChatSessionStore.getState();
  store.appendUserMessage(paneId, content);
  store.setStatus(paneId, "streaming");
  store.setError(paneId, null);
  window.api.chat.send(paneId, content);
}

/**
 * Chat バックエンドの開始。CWD は引数で渡す（ペインの meta.cwd を呼び出し側で解決する）。
 * resumeSessionId が渡された場合は `--resume` で継続。
 */
export async function startChatSession(
  paneId: string,
  cwd: string,
  options?: { resumeSessionId?: string },
): Promise<{ ok: boolean; error?: string }> {
  const store = useChatSessionStore.getState();
  // 既に起動中（starting / streaming）のセッションがあれば多重起動を避けて成功扱いで返す。
  // 自動検出 + ChatPaneView マウントの useEffect が同時に start を試みた際の競合を吸収する。
  const existing = store.sessions.get(paneId);
  if (
    existing &&
    (existing.status === "starting" || existing.status === "streaming")
  ) {
    return { ok: true };
  }
  store.getOrCreate(paneId);
  store.setStatus(paneId, "starting");
  store.setError(paneId, null);

  const result = await window.api.chat.start(paneId, cwd, options);
  if (!result.ok) {
    // session_already_started は Main 側に既存セッションがあるという意味。
    // Renderer 側のセッション ID を Main から取り直して idle 復帰させる。
    if (result.error === "session_already_started") {
      const sid = await window.api.chat.getSessionId(paneId);
      if (sid) store.setSessionId(paneId, sid);
      store.setStatus(paneId, "idle");
      return { ok: true };
    }
    store.setStatus(paneId, "error");
    store.setError(paneId, result.error ?? "chat_start_failed");
    return { ok: false, error: result.error };
  }
  if (result.sessionId) {
    store.setSessionId(paneId, result.sessionId);
  }
  // 起動成功 → idle に遷移。次のユーザー入力で streaming になる。
  store.setStatus(paneId, "idle");
  return { ok: true };
}

/**
 * 現在のターンを停止する。SIGTERM で claude プロセスは exit するが、
 * Renderer 側の sessionId は保持し続けるので、次のメッセージ送信時に
 * `--resume <sessionId>` で再開できる。status の遷移は end イベントに任せる
 * （ここで idle に上書きすると end の "ended" との競合になる）。
 */
export function stopChatSession(paneId: string): void {
  window.api.chat.stop(paneId);
}

export function disposeChatSession(paneId: string): void {
  window.api.chat.dispose(paneId);
  useChatSessionStore.getState().remove(paneId);
}

// ===== 内部: イベントハンドラ =====

function handleChatEvent(paneId: string, event: ChatEventEnvelope): void {
  const store = useChatSessionStore.getState();
  switch (event.type) {
    case "session.id":
      store.setSessionId(paneId, event.sessionId);
      return;
    case "system":
      handleSystemEvent(paneId, event.payload);
      return;
    case "stream":
      handleStreamEvent(paneId, event.payload);
      return;
    case "assistant":
      handleAssistantEvent(paneId, event.payload);
      return;
    case "user":
      handleUserEvent(paneId, event.payload);
      return;
    case "result":
      handleResultEvent(paneId, event.payload);
      return;
    case "rate_limit":
      // MVP では UI 表示せずログのみ。詳細は payload に含まれる
      console.warn("[chat] rate_limit_event", event.payload);
      return;
    case "error":
      store.setStatus(paneId, "error");
      store.setError(paneId, event.message);
      return;
    case "end":
      // プロセス終了。ステータスは error 扱いでなく ended として記録（再起動可能な状態）
      store.setStatus(paneId, "ended");
      return;
    default: {
      // exhaustiveness check
      const _exhaustive: never = event;
      void _exhaustive;
    }
  }
}

function handleSystemEvent(
  _paneId: string,
  _payload: Record<string, unknown>,
): void {
  // system.init.session_id は session.id イベントで先に届くので、ここでは UI 反映なし。
  // hook 系は無視。詳細デバッグ用に必要なら console に流す。
}

function handleStreamEvent(
  paneId: string,
  payload: Record<string, unknown>,
): void {
  // stream_event.event.type で SSE 互換イベントを取り出す
  const event = payload.event as Record<string, unknown> | undefined;
  if (!event) return;
  const eventType = String(event.type ?? "");
  const store = useChatSessionStore.getState();

  switch (eventType) {
    case "message_start": {
      const message = event.message as { id?: unknown } | undefined;
      const messageId = typeof message?.id === "string" ? message.id : null;
      store.beginAssistantMessage(paneId, messageId);
      return;
    }
    case "content_block_start": {
      // text / tool_use / thinking のいずれか。
      // currentActivity を設定して ChatStatusBar に進捗を表示する。
      const block = event.content_block as Record<string, unknown> | undefined;
      if (!block) return;
      const blockType = String(block.type ?? "");
      if (blockType === "tool_use") {
        const id = typeof block.id === "string" ? block.id : "";
        const name = typeof block.name === "string" ? block.name : "";
        if (id && name) {
          const tool: ChatToolUse = {
            id,
            name,
            input: {},
            resultText: null,
            resultIsError: false,
          };
          store.recordToolUse(paneId, tool);
          store.setActivity(paneId, {
            kind: "tool_use",
            toolName: name,
            description: null,
          });
        }
      } else if (blockType === "thinking") {
        store.setActivity(paneId, { kind: "thinking" });
      } else if (blockType === "text") {
        store.setActivity(paneId, { kind: "text" });
      }
      return;
    }
    case "content_block_delta": {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (!delta) return;
      const deltaType = String(delta.type ?? "");
      if (deltaType === "text_delta" && typeof delta.text === "string") {
        store.appendAssistantDelta(paneId, delta.text);
      } else if (
        deltaType === "thinking_delta" &&
        typeof delta.thinking === "string"
      ) {
        store.appendThinkingDelta(paneId, delta.thinking);
      }
      // input_json_delta は MVP では UI 反映せず（tool 入力の組み立て）
      return;
    }
    case "content_block_stop":
      // ブロック単位の停止。activity をクリアして次の block_start を待つ。
      store.setActivity(paneId, null);
      return;
    case "message_delta":
    case "message_stop":
      // メッセージ終端は assistant イベント or result イベントで finalize する想定なので、
      // ここでは activity だけクリアする
      store.setActivity(paneId, null);
      return;
    default:
      return;
  }
}

function handleAssistantEvent(
  paneId: string,
  payload: Record<string, unknown>,
): void {
  // assistant の最終メッセージ（content[] の text を結合 + tool_use を吸収）
  const message = payload.message as
    | { id?: unknown; content?: unknown }
    | undefined;
  if (!message) return;
  const contents = Array.isArray(message.content) ? message.content : [];
  const store = useChatSessionStore.getState();

  // streaming 中に貯まっていない場合（partial-messages 無効時等）に備えて、
  // ここで text を抽出して beginAssistantMessage → appendDelta → finalize の流れを補完する
  let text = "";
  let thinking: string | null = null;
  const toolUses: ChatToolUse[] = [];
  for (const c of contents) {
    if (!c || typeof c !== "object") continue;
    const block = c as Record<string, unknown>;
    const blockType = String(block.type ?? "");
    if (blockType === "text" && typeof block.text === "string") {
      text += block.text;
    } else if (blockType === "thinking" && typeof block.thinking === "string") {
      thinking = (thinking ?? "") + block.thinking;
    } else if (blockType === "tool_use") {
      const id = typeof block.id === "string" ? block.id : "";
      const name = typeof block.name === "string" ? block.name : "";
      const input =
        block.input && typeof block.input === "object"
          ? (block.input as Record<string, unknown>)
          : {};
      if (id && name) {
        toolUses.push({
          id,
          name,
          input,
          resultText: null,
          resultIsError: false,
        });
      }
    }
  }

  // 既に streaming で蓄積済みなら finalize するだけ。バッファが空（partial-messages 無効ケース）
  // なら、ここで明示的に begin → append → finalize を走らせる
  const state = store.sessions.get(paneId);
  const messageId = typeof message.id === "string" ? message.id : null;
  if (!state || state.currentAssistantBuffer.length === 0) {
    store.beginAssistantMessage(paneId, messageId);
    if (text.length > 0) store.appendAssistantDelta(paneId, text);
    if (thinking) store.appendThinkingDelta(paneId, thinking);
  }
  // tool_use は pending として記録（後続 user.tool_result で結果が来る）
  for (const t of toolUses) {
    store.recordToolUse(paneId, t);
  }

  // 認証エラーの即時検出（chat-session-manager 側でも error イベントを別途流すが、
  // ここでも UI に反映するために handle）
  if (
    typeof payload.error === "string" &&
    payload.error === "authentication_failed"
  ) {
    store.setStatus(paneId, "error");
    store.setError(paneId, "authentication_failed");
    // 認証失敗時はバナーメッセージとして text に出ているので finalize して表示
    store.finalizeAssistantMessage(paneId, toolUses);
    return;
  }

  // toolUses を assistant message に紐付けて finalize する。
  // 後で来る tool_result は recordToolResult が同 message の toolUses[].id を見て注入する。
  store.finalizeAssistantMessage(paneId, toolUses);
}

function handleUserEvent(
  paneId: string,
  payload: Record<string, unknown>,
): void {
  // claude が自動生成する system 側 user メッセージ。tool_result を含む。
  const message = payload.message as { content?: unknown } | undefined;
  if (!message) return;
  const contents = Array.isArray(message.content) ? message.content : [];
  const store = useChatSessionStore.getState();
  for (const c of contents) {
    if (!c || typeof c !== "object") continue;
    const block = c as Record<string, unknown>;
    if (String(block.type ?? "") !== "tool_result") continue;
    const toolUseId =
      typeof block.tool_use_id === "string" ? block.tool_use_id : "";
    const isError = block.is_error === true;
    const raw = block.content;
    let resultText = "";
    if (typeof raw === "string") {
      resultText = raw;
    } else if (Array.isArray(raw)) {
      // [{ type: "text", text: "..." }, ...] 形式
      for (const item of raw) {
        if (
          item &&
          typeof item === "object" &&
          (item as Record<string, unknown>).type === "text"
        ) {
          const t = (item as Record<string, unknown>).text;
          if (typeof t === "string") resultText += t;
        }
      }
    }
    if (toolUseId) {
      store.recordToolResult(paneId, toolUseId, resultText, isError);
    }
  }
}

function handleResultEvent(
  paneId: string,
  payload: Record<string, unknown>,
): void {
  // ターン完了。streaming 中バッファが残っていれば finalize する（assistant イベントが
  // 既に finalize 済みなら no-op に近い動作）。
  const store = useChatSessionStore.getState();
  const state = store.sessions.get(paneId);
  if (state && state.currentAssistantBuffer.length > 0) {
    store.finalizeAssistantMessage(paneId);
  }
  // is_error が true なら lastError を更新
  if (payload.is_error === true) {
    const result = typeof payload.result === "string" ? payload.result : null;
    store.setStatus(paneId, "error");
    store.setError(paneId, result ?? "result_error");
    return;
  }
  store.setStatus(paneId, "idle");
}

// ===== 自動検出ハンドラ =====

function handleClaudeDetected(paneId: string): void {
  // PTY 上で claude TUI が起動した。viewMode を chat に切替えるだけ。
  // 実際の chat バックエンド起動は ChatPaneView マウント時の useEffect 一本に集約する
  // （二重起動による session_already_started エラーを防ぐため）。
  const meta = useTerminalMetaStore.getState().metas.get(paneId);
  if (!meta) return;
  if (meta.viewMode === "chat") return;
  useTerminalMetaStore.getState().setViewMode(paneId, "chat");
}
