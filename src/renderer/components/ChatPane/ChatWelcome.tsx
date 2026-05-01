import React from "react";
import { useCurrentTheme } from "../../stores/themeStore";

type WelcomePhase = "trust-pending" | "starting" | "ready";

interface ChatWelcomeProps {
  phase: WelcomePhase;
}

/**
 * Chat ペインがまだメッセージを持たない状態で中央に表示するウェルカムパネル。
 * - phase="trust-pending": 信頼確認モーダルが背後に出ている / これから出る状態。
 * - phase="starting": chat:start 中（claude プロセス起動中）
 * - phase="ready": idle 状態。最初のメッセージ待ち。
 *
 * 仕様:
 * - メインタイトル: 「今日はどんなタスクをしますか？」
 * - サブテキスト: phase によって変える
 * - 最初のメッセージ送信で MessageList に置き換わるため、本コンポーネント側で消える制御はしない
 */
const ChatWelcome: React.FC<ChatWelcomeProps> = React.memo(({ phase }) => {
  const currentTheme = useCurrentTheme();
  const colors = currentTheme.colors;

  let subText: string;
  if (phase === "trust-pending") {
    subText = "ディレクトリの信頼を確認してください";
  } else if (phase === "starting") {
    subText = "Claude を起動しています...";
  } else {
    subText = "メッセージを入力して開始（Enter で送信 / Shift+Enter で改行）";
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 32,
        textAlign: "center",
        userSelect: "none",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: `linear-gradient(135deg, ${colors.accent} 0%, ${colors.activeTerminal} 100%)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: colors.background,
          fontSize: 28,
          fontWeight: 700,
          boxShadow: `0 6px 18px ${colors.accent}33`,
          animation:
            phase === "starting"
              ? "td-chat-welcome-pulse 1.6s ease-in-out infinite"
              : "none",
        }}
      >
        ✦
      </div>

      <div
        style={{
          color: colors.text,
          fontSize: 19,
          fontWeight: 600,
          letterSpacing: 0.2,
        }}
      >
        今日はどんなタスクをしますか？
      </div>

      <div
        style={{
          color: colors.textSecondary,
          fontSize: 12.5,
          lineHeight: 1.6,
          maxWidth: 360,
        }}
      >
        {subText}
      </div>

      {phase === "ready" && (
        <div
          style={{
            marginTop: 6,
            color: colors.textSecondary,
            fontSize: 11.5,
            opacity: 0.75,
          }}
        >
          ヒント: <code style={codeStyle(colors.headerBackground)}>/</code>{" "}
          を入力するとスキル / コマンド候補が表示されます（Tab で挿入）
        </div>
      )}

      <style>{`
        @keyframes td-chat-welcome-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(0.94); opacity: 0.78; }
        }
      `}</style>
    </div>
  );
});

ChatWelcome.displayName = "ChatWelcome";

function codeStyle(bg: string): React.CSSProperties {
  return {
    fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
    background: bg,
    padding: "1px 6px",
    borderRadius: 3,
    fontSize: 11,
  };
}

export { ChatWelcome };
