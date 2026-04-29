import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useCurrentTheme } from "../../stores/themeStore";
import { useChatState } from "../../stores/chatSessionStore";
import { useTerminalMetaStore } from "../../stores/terminalMetaStore";
import {
  sendChatMessage,
  startChatSession,
  stopChatSession,
} from "../../services/chatBridge";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { ChatStatusBar } from "./ChatStatusBar";

interface ChatPaneViewProps {
  id: string;
}

/**
 * Chat ビューのコンテナ。
 * - mount で chat:start を 1 回だけ呼ぶ。chat 状態の変化では再 start しない
 *   （二重 start を防ぐため startedRef + 依存は [id] のみに固定）
 * - unmount では dispose しない（タブ切替で hidden になっても会話履歴を保持するため。MD と同じ戦略）
 * - 停止後に再度メッセージを送ると、自動で `--resume <sessionId>` で再起動してから送信
 */
const ChatPaneView: React.FC<ChatPaneViewProps> = React.memo(({ id }) => {
  const currentTheme = useCurrentTheme();
  const colors = currentTheme.colors;
  const chat = useChatState(id);

  const startedRef = useRef(false);

  // 最新の chat 状態を ref で保持して useEffect の依存を増やさない
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const ensureStart = useCallback(
    async (resumeSessionId?: string): Promise<{ ok: boolean }> => {
      const meta = useTerminalMetaStore.getState().metas.get(id);
      const cwd = meta?.cwd ?? "";
      const result = await startChatSession(id, cwd, { resumeSessionId });
      return { ok: result.ok };
    },
    [id],
  );

  // 初回マウントで 1 度だけ起動する。再 mount（StrictMode の二重マウント）でも startedRef で
  // ガードされるため、chat:start が二重に呼ばれて session_already_started になることを防ぐ。
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const current = chatRef.current;
    // 既に session が動いている / 履歴がある場合はそのまま再利用する
    if (
      current &&
      (current.status === "starting" ||
        current.status === "streaming" ||
        current.messages.length > 0)
    ) {
      return;
    }
    void ensureStart(current?.sessionId ?? undefined);
  }, [id, ensureStart]);

  const handleSubmit = useCallback(
    async (text: string) => {
      const current = chatRef.current;
      // 停止後 / エラー後でも、再度入力を受け取ったら resume で自動再起動してから送る。
      // これにより「停止 → 再起動ボタン」のクリックを介さず、入力欄から直接続行できる。
      if (current?.status === "ended" || current?.status === "error") {
        const result = await ensureStart(current?.sessionId ?? undefined);
        if (!result.ok) return;
      }
      sendChatMessage(id, text);
    },
    [id, ensureStart],
  );

  const handleStop = useCallback(() => {
    stopChatSession(id);
  }, [id]);

  const handleRestart = useCallback(() => {
    void ensureStart(chat?.sessionId ?? undefined);
  }, [chat?.sessionId, ensureStart]);

  // CLI ビューに戻る（chat session は破棄せず保持）
  const handleSwitchToCli = useCallback(() => {
    useTerminalMetaStore.getState().setViewMode(id, "cli");
  }, [id]);

  // CLI で続きを表示: PTY 上で `claude --resume <sessionId>` を実行し、
  // viewMode を cli に切替える。Phase 0 検証で動作確認済（Q2「会話継続」）。
  // PTY が現在シェルプロンプトに居ない場合は混入する可能性がある（MVP 割り切り）。
  const handleContinueInCli = useCallback(() => {
    const sid = chat?.sessionId;
    if (!sid) {
      useTerminalMetaStore.getState().setViewMode(id, "cli");
      return;
    }
    // viewMode を先に切替えて見た目を合わせ、PTY に書き込む
    useTerminalMetaStore.getState().setViewMode(id, "cli");
    window.api.pty.write(id, `claude --resume ${sid}\n`);
  }, [id, chat?.sessionId]);

  const isStreaming =
    chat?.status === "streaming" || chat?.status === "starting";
  const streamingText = chat?.currentAssistantBuffer ?? "";
  const streamingMessageId = chat?.currentMessageId ?? null;

  const containerStyle = useMemo<React.CSSProperties>(
    () => ({
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      background: colors.background,
      color: colors.text,
    }),
    [colors.background, colors.text],
  );

  return (
    <div style={containerStyle}>
      <MessageList
        messages={chat?.messages ?? []}
        streamingMessageId={streamingMessageId}
        streamingText={streamingText}
        isStreaming={isStreaming}
      />
      <ChatStatusBar
        status={chat?.status ?? "idle"}
        error={chat?.lastError ?? null}
        sessionId={chat?.sessionId ?? null}
        activity={chat?.currentActivity ?? null}
        onRestart={
          chat?.status === "error" || chat?.status === "ended"
            ? handleRestart
            : undefined
        }
        onSwitchToCli={handleSwitchToCli}
        onContinueInCli={handleContinueInCli}
      />
      <ChatInput
        onSubmit={handleSubmit}
        onStop={handleStop}
        isStreaming={isStreaming}
        // 入力は streaming 中以外は常に有効にする。ended/error 状態でも入力できるようにし、
        // 入力時に handleSubmit 側が必要に応じて自動再起動する。
        disabled={false}
      />
    </div>
  );
});

ChatPaneView.displayName = "ChatPaneView";

export { ChatPaneView };
