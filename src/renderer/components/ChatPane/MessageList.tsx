import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../types/chat";
import { MessageBubble } from "./MessageBubble";

interface MessageListProps {
  messages: ChatMessage[];
  // streaming 中のアシスタントバッファ。messages 末尾の assistant が finalize されるまで
  // 仮想的なメッセージとして表示する。
  streamingMessageId: string | null;
  streamingText: string;
  isStreaming: boolean;
}

const SCROLL_THRESHOLD = 24;

/**
 * 自動スクロール: ユーザーが最下部付近にいるときだけ最新メッセージへ追従する。
 * 上にスクロールして読んでいるときは固定（仮想化は MVP では入れず、表示メッセージ数の
 * 増加で問題が出れば react-virtuoso を Phase 4 で導入判断）。
 */
const MessageList: React.FC<MessageListProps> = React.memo(
  ({ messages, streamingMessageId, streamingText, isStreaming }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [followBottom, setFollowBottom] = useState(true);

    // ユーザーのスクロール位置を観測して followBottom を更新
    const handleScroll = (): void => {
      const el = scrollRef.current;
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setFollowBottom(distance < SCROLL_THRESHOLD);
    };

    // メッセージ更新 / streaming 中バッファ更新時に追従
    useLayoutEffect(() => {
      if (!followBottom) return;
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }, [messages, streamingText, followBottom]);

    // 初回マウント時は最下部へ
    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }, []);

    // 表示するメッセージ: 既存 messages + streaming 中なら仮想 assistant メッセージを末尾追加
    // ただし messages の末尾が同 id の assistant ならそちらを優先（finalize 済みケースの重複防止）
    const showVirtualStreaming =
      isStreaming &&
      streamingText.length > 0 &&
      (() => {
        const last = messages[messages.length - 1];
        if (!last) return true;
        return !(
          last.role === "assistant" &&
          streamingMessageId !== null &&
          last.id === streamingMessageId
        );
      })();

    return (
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "8px 0",
        }}
      >
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {showVirtualStreaming && (
          <MessageBubble
            key={streamingMessageId ?? "streaming"}
            message={{
              id: streamingMessageId ?? "streaming",
              role: "assistant",
              text: "",
              thinking: null,
              toolUses: [],
              receivedAt: Date.now(),
              status: "streaming",
              errorMessage: null,
            }}
            streamingText={streamingText}
          />
        )}
      </div>
    );
  },
);

MessageList.displayName = "MessageList";

export { MessageList };
