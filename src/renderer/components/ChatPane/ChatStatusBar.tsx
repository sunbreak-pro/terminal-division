import React from "react";
import { useCurrentTheme } from "../../stores/themeStore";
import type { ChatActivity, ChatStatus } from "../../types/chat";

interface ChatStatusBarProps {
  status: ChatStatus;
  error: string | null;
  sessionId: string | null;
  // 進行中の作業（思考 / ツール使用 / 通常テキスト）。streaming 中に表示
  activity: ChatActivity | null;
  onRestart?: () => void;
  // CLI ビューに戻る（chat session は破棄せず保持）
  onSwitchToCli?: () => void;
  // CLI ビューに戻り、PTY 上で `claude --resume <sessionId>` を実行して
  // この Chat の会話履歴を CLI 側でも続行する。バグ 2 への対応。
  onContinueInCli?: () => void;
}

/**
 * チャットの状態をペイン下部に小さく表示する。
 * - starting: 「セッションを開始しています...」
 * - streaming: 「Claude が作業中...」（pulsating dot）
 * - error: エラー文 + 再起動ボタン
 * - ended: プロセス終了の旨 + 再起動ボタン
 * - idle: 何も表示しない（最終応答完了状態）
 */
const ChatStatusBar: React.FC<ChatStatusBarProps> = React.memo(
  ({
    status,
    error,
    sessionId,
    activity,
    onRestart,
    onSwitchToCli,
    onContinueInCli,
  }) => {
    const currentTheme = useCurrentTheme();
    const colors = currentTheme.colors;

    // idle 時は「CLI で続きを表示」ボタンを出すために、status="idle" でも sessionId があれば表示する。
    // それ以外（status=idle && sessionId なし && error なし）なら何も表示しない。
    if (status === "idle" && !error && !sessionId) return null;

    const showRestart =
      (status === "error" || status === "ended") && onRestart !== undefined;
    const showSwitchToCli =
      (status === "error" || status === "ended") && onSwitchToCli !== undefined;
    const showContinueInCli =
      sessionId !== null &&
      onContinueInCli !== undefined &&
      // streaming 中は誤爆を避けるため非表示
      status !== "streaming" &&
      status !== "starting";

    let label = "";
    let dotColor = colors.textSecondary;
    if (status === "starting") {
      label = "セッションを開始しています...";
      dotColor = colors.accent;
    } else if (status === "streaming") {
      // streaming 中は activity の中身に応じて文言を切り替える。
      // tool_use 中は具体的なツール名を出して「何をやっているか」分かるようにする。
      label = formatActivity(activity);
      dotColor = colors.accent;
    } else if (status === "error") {
      label = formatError(error);
      dotColor = "rgba(255, 90, 90, 0.95)";
    } else if (status === "ended") {
      label = "セッションが終了しました";
      dotColor = colors.textSecondary;
    }

    return (
      <div
        style={{
          padding: "4px 12px",
          fontSize: 11.5,
          color: colors.textSecondary,
          background: colors.background,
          borderTop: `1px solid ${colors.border}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          minHeight: 22,
        }}
      >
        {label && (
          <>
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: dotColor,
                animation:
                  status === "streaming" || status === "starting"
                    ? "td-chat-pulse 1.2s ease-in-out infinite"
                    : "none",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flexShrink: 1,
                minWidth: 0,
              }}
              title={label}
            >
              {label}
            </span>
          </>
        )}
        {sessionId && status !== "error" && (
          <span
            style={{
              marginLeft: "auto",
              fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
              fontSize: 10.5,
              opacity: 0.6,
              flexShrink: 0,
            }}
            title={sessionId}
          >
            {sessionId.slice(0, 8)}
          </span>
        )}
        {showRestart && (
          <button
            type="button"
            onClick={onRestart}
            style={{
              marginLeft: sessionId ? 8 : "auto",
              background: "transparent",
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              padding: "1px 8px",
              color: colors.text,
              fontSize: 11,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            再起動
          </button>
        )}
        {showSwitchToCli && (
          <button
            type="button"
            onClick={onSwitchToCli}
            style={{
              marginLeft: showRestart || sessionId ? 4 : "auto",
              background: "transparent",
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              padding: "1px 8px",
              color: colors.text,
              fontSize: 11,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            CLI に戻る
          </button>
        )}
        {showContinueInCli && (
          <button
            type="button"
            onClick={onContinueInCli}
            title={`PTY 上で 'claude --resume <id>' を実行し、この会話を CLI に持ち込む`}
            style={{
              marginLeft:
                showRestart || showSwitchToCli || sessionId ? 4 : "auto",
              background: "transparent",
              border: `1px solid ${colors.accent}`,
              borderRadius: 4,
              padding: "1px 8px",
              color: colors.accent,
              fontSize: 11,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            CLI で続きを表示
          </button>
        )}
        <style>{`@keyframes td-chat-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }`}</style>
      </div>
    );
  },
);

ChatStatusBar.displayName = "ChatStatusBar";

export { ChatStatusBar };

function formatError(error: string | null): string {
  if (!error) return "エラーが発生しました";
  if (error === "authentication_failed") {
    return "未ログインです。CLI モードで `claude /login` を実行してください";
  }
  if (error === "claude_binary_not_found") {
    return "claude コマンドが見つかりません（PATH を確認してください）";
  }
  if (error === "session_already_started") {
    return "セッションは既に開始されています";
  }
  return error;
}

function formatActivity(activity: ChatActivity | null): string {
  if (!activity) return "Claude が作業中...";
  if (activity.kind === "thinking") return "Claude が思考中...";
  if (activity.kind === "text") return "Claude が応答を生成中...";
  if (activity.kind === "tool_use") {
    const desc = activity.description ? `: ${activity.description}` : "";
    return `${activity.toolName} を実行中${desc}`;
  }
  return "Claude が作業中...";
}
