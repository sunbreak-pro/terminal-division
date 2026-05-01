import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { ChatTrustPanel } from "./ChatTrustPanel";
import { ChatWelcome } from "./ChatWelcome";

interface ChatPaneViewProps {
  id: string;
}

type TrustState =
  | { phase: "checking" }
  | { phase: "needs-confirm"; cwd: string; isHome: boolean }
  | { phase: "trusted" }
  | { phase: "denied" };

/**
 * Chat ビューのコンテナ。
 * - mount で先に信頼確認 (chat:checkTrust) を行い、必要ならモーダルを出してから chat:start
 * - $HOME そのものは毎回確認、未信頼 CWD は最初の 1 回だけ確認
 * - unmount では dispose しない（タブ切替で hidden になっても会話履歴を保持するため。MD と同じ戦略）
 * - 停止後に再度メッセージを送ると、自動で `--resume <sessionId>` で再起動してから送信
 */
const ChatPaneView: React.FC<ChatPaneViewProps> = React.memo(({ id }) => {
  const currentTheme = useCurrentTheme();
  const colors = currentTheme.colors;
  const chat = useChatState(id);

  const startedRef = useRef(false);
  const [trustState, setTrustState] = useState<TrustState>({
    phase: "checking",
  });

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

  // 初回マウントで信頼確認 → 必要なら start。
  // 既に session が動いている / 履歴があるケースは start をスキップしつつ trustState は trusted に揃える。
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const current = chatRef.current;
    const alreadyRunning =
      current &&
      (current.status === "starting" ||
        current.status === "streaming" ||
        current.messages.length > 0);

    if (alreadyRunning) {
      // 既に起動済み（再 mount 等）。信頼確認は省略。
      setTrustState({ phase: "trusted" });
      return;
    }

    const meta = useTerminalMetaStore.getState().metas.get(id);
    const cwd = meta?.cwd ?? "";
    void (async () => {
      // dev hot-reload 等で preload が更新されていない場合は IPC が未定義になりうる。
      // その場合は信頼チェックをスキップして起動する（UX を止めないため、安全側ではなく寛容側に倒す）。
      const checkTrust = window.api.chat.checkTrust;
      if (typeof checkTrust !== "function") {
        console.warn(
          "[Chat] window.api.chat.checkTrust が未定義です。Electron アプリを再起動してください。信頼チェックをスキップして起動します。",
        );
        setTrustState({ phase: "trusted" });
        void ensureStart(current?.sessionId ?? undefined);
        return;
      }
      try {
        const trust = await checkTrust(cwd);
        if (trust.trusted) {
          setTrustState({ phase: "trusted" });
          void ensureStart(current?.sessionId ?? undefined);
          return;
        }
        // $HOME または未信頼 CWD → 信頼確認パネル
        setTrustState({
          phase: "needs-confirm",
          cwd: trust.cwd,
          isHome: trust.isHome,
        });
      } catch (e) {
        console.warn("[Chat] checkTrust failed:", e);
        // IPC エラー時もスタックを止めず起動する
        setTrustState({ phase: "trusted" });
        void ensureStart(current?.sessionId ?? undefined);
      }
    })();
  }, [id, ensureStart]);

  const handleTrustConfirm = useCallback((): void => {
    if (trustState.phase !== "needs-confirm") return;
    if (!trustState.isHome) {
      // $HOME 以外は永続化（Main 側で $HOME は弾かれる）
      window.api.chat.trust(trustState.cwd);
    }
    setTrustState({ phase: "trusted" });
    const current = chatRef.current;
    void ensureStart(current?.sessionId ?? undefined);
  }, [trustState, ensureStart]);

  const handleTrustCancel = useCallback((): void => {
    setTrustState({ phase: "denied" });
  }, []);

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

  // 信頼確認が完了するまでは入力をロック（cancel で denied になるとそのままロック維持）
  const inputDisabled =
    trustState.phase !== "trusted" ||
    chat === undefined ||
    chat.status === "starting";

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

  // メッセージ未送信 + idle/checking の状態で Welcome を出す。
  // streaming 中や error / ended のときは Welcome を出さない。
  // 信頼確認 / denied のときは Welcome ではなく専用パネル。
  const showWelcome =
    (chat?.messages.length ?? 0) === 0 &&
    !isStreaming &&
    chat?.status !== "error" &&
    chat?.status !== "ended" &&
    trustState.phase === "trusted";

  // メイン領域はトップレベルの状態で 1 つだけ描画する：
  // 1. needs-confirm / checking → 信頼確認パネル（インライン）
  // 2. denied                   → 拒否バナー（再試行可）
  // 3. welcome                  → スタートUI
  // 4. それ以外                  → メッセージ一覧
  let mainArea: React.ReactNode;
  if (trustState.phase === "needs-confirm") {
    mainArea = (
      <ChatTrustPanel
        cwd={trustState.cwd}
        isHome={trustState.isHome}
        onTrust={handleTrustConfirm}
        onCancel={handleTrustCancel}
      />
    );
  } else if (trustState.phase === "checking") {
    // 通常は数 ms で終わるが、IPC 完了前のフラッシュ防止のため最小限の表示にする
    mainArea = <CheckingPanel />;
  } else if (trustState.phase === "denied") {
    mainArea = (
      <DeniedBanner
        onRetry={() => {
          const meta = useTerminalMetaStore.getState().metas.get(id);
          const cwd = meta?.cwd ?? "";
          void (async () => {
            const trust = await window.api.chat.checkTrust(cwd);
            setTrustState({
              phase: "needs-confirm",
              cwd: trust.cwd,
              isHome: trust.isHome,
            });
          })();
        }}
      />
    );
  } else if (showWelcome) {
    mainArea = (
      <ChatWelcome phase={chat?.status === "starting" ? "starting" : "ready"} />
    );
  } else {
    mainArea = (
      <MessageList
        messages={chat?.messages ?? []}
        streamingMessageId={streamingMessageId}
        streamingText={streamingText}
        isStreaming={isStreaming}
      />
    );
  }

  return (
    <div style={containerStyle}>
      {mainArea}
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
        disabled={inputDisabled}
        cwd={useTerminalMetaStore.getState().metas.get(id)?.cwd ?? ""}
      />
    </div>
  );
});

const CheckingPanel: React.FC = () => {
  const currentTheme = useCurrentTheme();
  const colors = currentTheme.colors;
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: colors.textSecondary,
        fontSize: 12.5,
        gap: 1,
      }}
    >
      <span>確認中</span>
      <BouncingDots color={colors.textSecondary} />
    </div>
  );
};

/**
 * 三点ドットを順番に上下バウンスさせるローディング表現。
 * 確認中 / 起動中など「処理待ち」を視覚化する用途で使う。
 */
const BouncingDots: React.FC<{ color: string }> = ({ color }) => {
  const dotStyle = (delay: number): React.CSSProperties => ({
    display: "inline-block",
    width: "0.4em",
    color,
    animation: "td-chat-dot-bounce 1.1s ease-in-out infinite",
    animationDelay: `${delay}ms`,
  });
  return (
    <span aria-hidden style={{ display: "inline-flex" }}>
      <span style={dotStyle(0)}>.</span>
      <span style={dotStyle(160)}>.</span>
      <span style={dotStyle(320)}>.</span>
      <style>{`
        @keyframes td-chat-dot-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
          30% { transform: translateY(-3px); opacity: 1; }
        }
      `}</style>
    </span>
  );
};

ChatPaneView.displayName = "ChatPaneView";

const DeniedBanner: React.FC<{ onRetry: () => void }> = ({ onRetry }) => {
  const currentTheme = useCurrentTheme();
  const colors = currentTheme.colors;
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
        color: colors.textSecondary,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 14, color: colors.text }}>
        このディレクトリを信頼しないと Chat を開始できません
      </div>
      <button
        type="button"
        onClick={onRetry}
        style={{
          padding: "6px 14px",
          background: "transparent",
          color: colors.accent,
          border: `1px solid ${colors.accent}`,
          borderRadius: 4,
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        確認をやり直す
      </button>
    </div>
  );
};

export { ChatPaneView };
