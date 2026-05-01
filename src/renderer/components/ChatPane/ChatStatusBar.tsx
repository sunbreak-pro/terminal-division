import React, { useEffect, useState } from "react";
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
  // この Chat の会話履歴を CLI 側でも続行する。
  onContinueInCli?: () => void;
}

// 作業中の文言プール。kind ごとに区切り、定期的にローテーションして
// 「同じ表示が固まっている」感を避ける。
const PHRASES = {
  starting: [
    "セッションを起動しています",
    "Claude を呼び出し中",
    "プロセスを準備しています",
  ],
  thinking: [
    "思考しています",
    "アプローチを検討中",
    "次の一手を組み立て中",
    "プランを練っています",
  ],
  text: ["応答を生成しています", "言葉を選んでいます", "回答を組み立て中"],
  generic: ["作業中", "処理中", "実行中"],
} as const;

const TOOL_VERBS: Record<string, string> = {
  Bash: "シェルコマンドを実行中",
  Read: "ファイルを読み込み中",
  Edit: "ファイルを編集中",
  Write: "ファイルを書き込み中",
  Grep: "コードを検索中",
  Glob: "ファイルを探索中",
  WebFetch: "ウェブを取得中",
  WebSearch: "ウェブを検索中",
  Task: "サブエージェントを起動中",
  TodoWrite: "タスクを更新中",
  NotebookEdit: "ノートブックを編集中",
};

// kind ごとのバッジ文言（タイトな短文）
function badgeLabel(status: ChatStatus, activity: ChatActivity | null): string {
  if (status === "starting") return "起動中";
  if (status === "error") return "エラー";
  if (status === "ended") return "終了";
  if (status !== "streaming") return "";
  if (!activity) return "作業中";
  if (activity.kind === "thinking") return "思考中";
  if (activity.kind === "text") return "出力中";
  if (activity.kind === "tool_use") return "ツール実行中";
  return "作業中";
}

// 詳細文言（バッジの右に出すサブテキスト）
function detailLabel(
  status: ChatStatus,
  activity: ChatActivity | null,
  rotateIndex: number,
): string {
  if (status === "starting") {
    return PHRASES.starting[rotateIndex % PHRASES.starting.length];
  }
  if (status !== "streaming") return "";
  if (!activity) {
    return PHRASES.generic[rotateIndex % PHRASES.generic.length];
  }
  if (activity.kind === "thinking") {
    return PHRASES.thinking[rotateIndex % PHRASES.thinking.length];
  }
  if (activity.kind === "text") {
    return PHRASES.text[rotateIndex % PHRASES.text.length];
  }
  if (activity.kind === "tool_use") {
    const verb =
      TOOL_VERBS[activity.toolName] ?? `${activity.toolName} を実行中`;
    return activity.description ? `${verb}: ${activity.description}` : verb;
  }
  return PHRASES.generic[rotateIndex % PHRASES.generic.length];
}

/**
 * チャットの状態をペイン下部に表示するステータスバー。
 * - 動作中（starting / streaming）はシマーが流れる「[● 作業中]」バッジ + 詳細文言
 * - error: エラー文 + 再起動ボタン
 * - ended: プロセス終了の旨 + 再起動ボタン
 * - idle: sessionId があれば「CLI で続きを表示」のみ
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

    // 文言ローテーション（2.4s ごとに index++）。動作中のみ更新。
    const isWorking = status === "starting" || status === "streaming";
    const [rotate, setRotate] = useState(0);
    useEffect(() => {
      if (!isWorking) {
        setRotate(0);
        return;
      }
      const t = setInterval(() => setRotate((i) => i + 1), 2400);
      return () => clearInterval(t);
    }, [isWorking]);

    // idle 時は「CLI で続きを表示」ボタンを出すために、status="idle" でも sessionId があれば表示する。
    if (status === "idle" && !error && !sessionId) return null;

    const showRestart =
      (status === "error" || status === "ended") && onRestart !== undefined;
    const showSwitchToCli =
      (status === "error" || status === "ended") && onSwitchToCli !== undefined;
    const showContinueInCli =
      sessionId !== null &&
      onContinueInCli !== undefined &&
      status !== "streaming" &&
      status !== "starting";

    const badge = badgeLabel(status, activity);
    let detail = "";
    if (status === "error") {
      detail = formatError(error);
    } else if (status === "ended") {
      detail = "セッションが終了しました";
    } else {
      detail = detailLabel(status, activity, rotate);
    }

    // バッジ色: 動作中 = accent / error = danger / ended = secondary
    let badgeColor = colors.textSecondary;
    let badgeBg = "transparent";
    if (status === "error") {
      badgeColor = colors.danger ?? "#ff5a5a";
      badgeBg = `${badgeColor}1f`;
    } else if (status === "ended") {
      badgeColor = colors.textSecondary;
      badgeBg = `${colors.border}55`;
    } else if (isWorking) {
      badgeColor = colors.accent;
      badgeBg = `${colors.accent}22`;
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
          minHeight: 24,
        }}
      >
        {badge && (
          <span
            aria-live="polite"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "1px 7px",
              borderRadius: 10,
              background: badgeBg,
              color: badgeColor,
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: 0.2,
              flexShrink: 0,
              border: `1px solid ${badgeColor}33`,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: badgeColor,
                animation: isWorking
                  ? "td-chat-pulse 1.2s ease-in-out infinite"
                  : "none",
              }}
            />
            [{badge}]
          </span>
        )}
        {detail && (
          <span
            title={detail}
            style={{
              flexShrink: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              ...(isWorking
                ? {
                    background: `linear-gradient(90deg, ${colors.textSecondary} 0%, ${colors.text} 50%, ${colors.textSecondary} 100%)`,
                    backgroundSize: "200% 100%",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                    animation: "td-chat-shimmer 2.4s linear infinite",
                  }
                : { color: colors.textSecondary }),
            }}
          >
            {detail}
          </span>
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
        <style>{`
          @keyframes td-chat-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
          @keyframes td-chat-shimmer {
            0% { background-position: 100% 0; }
            100% { background-position: -100% 0; }
          }
        `}</style>
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
