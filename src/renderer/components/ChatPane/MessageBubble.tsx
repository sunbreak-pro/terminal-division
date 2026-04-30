import React, { useCallback, useMemo, useRef, useState } from "react";
import { useCurrentTheme } from "../../stores/themeStore";
import { useChatSettings } from "../../stores/settingsStore";
import type { ChatMessage, ChatToolUse } from "../../types/chat";
import { ToolDetailPopover } from "./ToolDetailPopover";

interface MessageBubbleProps {
  message: ChatMessage;
  // streaming 中のアシスタントバッファを表示する場合に使う（確定済み message の text と独立）
  streamingText?: string | null;
}

/**
 * 1 メッセージ分のバブル。MVP では本格的な Markdown レンダリングはせず、
 * - 改行を `<br>` に変換
 * - ```...``` のコードブロックを `<pre>` に変換
 * - インライン `code` を `<code>` に変換
 * の 3 段階だけサポートする軽量実装。
 *
 * 将来 react-markdown を導入する際はこの関数本体だけ差し替える想定。
 */
const MessageBubble: React.FC<MessageBubbleProps> = React.memo(
  ({ message, streamingText }) => {
    const currentTheme = useCurrentTheme();
    const colors = currentTheme.colors;
    const chatSettings = useChatSettings();

    const isUser = message.role === "user";
    const isError = message.status === "error";

    const displayText = useMemo(() => {
      if (streamingText !== null && streamingText !== undefined) {
        return streamingText;
      }
      return message.text;
    }, [message.text, streamingText]);

    const rendered = useMemo(
      () => renderMarkdownLite(displayText),
      [displayText],
    );

    const bubbleStyle: React.CSSProperties = useMemo(
      () => ({
        maxWidth: "85%",
        padding: "10px 14px",
        borderRadius: 10,
        background: isUser
          ? colors.activeTerminal
          : isError
            ? "rgba(255, 80, 80, 0.12)"
            : colors.headerBackground,
        color: isError ? colors.text : colors.text,
        border: isUser ? "none" : `1px solid ${colors.border}`,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        lineHeight: 1.55,
        fontSize: chatSettings.fontSize,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
      }),
      [colors, isUser, isError, chatSettings.fontSize],
    );

    const isStreaming = message.status === "streaming";

    return (
      <div
        style={{
          display: "flex",
          justifyContent: isUser ? "flex-end" : "flex-start",
          alignItems: "flex-start",
          gap: 8,
          padding: "6px 12px",
        }}
      >
        {!isUser && (
          <ClaudeAvatar
            isStreaming={isStreaming}
            accentColor={colors.accent}
            backgroundColor={colors.headerBackground}
            borderColor={colors.border}
          />
        )}
        <div style={bubbleStyle}>
          {message.thinking && !isUser && (
            <details
              style={{
                marginBottom: 8,
                fontSize: 12,
                color: colors.textSecondary,
                opacity: 0.85,
              }}
            >
              <summary style={{ cursor: "pointer", userSelect: "none" }}>
                思考過程
              </summary>
              <div
                style={{
                  marginTop: 4,
                  padding: "6px 8px",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {message.thinking}
              </div>
            </details>
          )}
          {message.toolUses.length > 0 && !isUser && (
            <ToolUseList
              tools={message.toolUses}
              hasFollowingText={Boolean(rendered)}
            />
          )}
          {rendered}
          {message.errorMessage && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "rgba(255, 90, 90, 0.95)",
              }}
            >
              {message.errorMessage}
            </div>
          )}
        </div>
      </div>
    );
  },
);

MessageBubble.displayName = "MessageBubble";

export { MessageBubble };

// ============== MD lite renderer ==============
// fenced code block + inline code + 改行のみ。
// 将来 react-markdown に置換する前提。安全のため innerHTML は使わず JSX で構築。

interface RenderPart {
  kind: "text" | "code-block" | "inline-code";
  content: string;
  lang?: string;
}

function tokenize(text: string): RenderPart[] {
  const parts: RenderPart[] = [];
  // 1) fenced code block を抽出
  const fenceRe = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ kind: "text", content: text.slice(lastIndex, m.index) });
    }
    parts.push({ kind: "code-block", content: m[2], lang: m[1] || undefined });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ kind: "text", content: text.slice(lastIndex) });
  }
  return parts;
}

function renderMarkdownLite(text: string): React.ReactNode {
  if (!text) return null;
  const parts = tokenize(text);
  return parts.map((part, i) => {
    if (part.kind === "code-block") {
      return (
        <pre
          key={i}
          style={{
            background: "rgba(0,0,0,0.35)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
            padding: "8px 10px",
            margin: "6px 0",
            overflowX: "auto",
            fontSize: 12.5,
            fontFamily:
              '"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            whiteSpace: "pre",
          }}
        >
          <code>{part.content}</code>
        </pre>
      );
    }
    // text 部分: インライン `code` を <code> に置換
    return <span key={i}>{renderInline(part.content)}</span>;
  });
}

// ============== Claude avatar ==============
// アシスタント発言の左に表示する小さなアバター。streaming 中はパルス。
interface ClaudeAvatarProps {
  isStreaming: boolean;
  accentColor: string;
  backgroundColor: string;
  borderColor: string;
}

const ClaudeAvatar: React.FC<ClaudeAvatarProps> = React.memo(
  ({ isStreaming, accentColor, backgroundColor, borderColor }) => {
    return (
      <div
        aria-label="Claude"
        title="Claude"
        style={{
          flexShrink: 0,
          width: 26,
          height: 26,
          marginTop: 2,
          borderRadius: "50%",
          border: `1px solid ${borderColor}`,
          background: backgroundColor,
          color: accentColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          lineHeight: 1,
          fontWeight: 700,
          animation: isStreaming
            ? "td-chat-avatar-pulse 1.4s ease-in-out infinite"
            : "none",
          userSelect: "none",
        }}
      >
        ✳
        <style>{`@keyframes td-chat-avatar-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
          50% { box-shadow: 0 0 0 4px rgba(255,255,255,0.10); }
        }`}</style>
      </div>
    );
  },
);
ClaudeAvatar.displayName = "ClaudeAvatar";

// ============== Tool use list (compact + popover) ==============
// チャット内でのツール使用表示は "薄く・小さく・トグル" の方針。
// - リスト全体は集約トグル「▸ N tools」で開閉できる
// - 各 chip は 1 行サマリ。クリックで ToolDetailPopover を開いて詳細閲覧
// - inline 展開は廃止（チャット肥大化を避けるため）

interface ToolUseListProps {
  tools: ChatToolUse[];
  hasFollowingText: boolean;
}

const ToolUseList: React.FC<ToolUseListProps> = React.memo(
  ({ tools, hasFollowingText }) => {
    const currentTheme = useCurrentTheme();
    const colors = currentTheme.colors;
    const [collapsed, setCollapsed] = useState(false);
    const [activeTool, setActiveTool] = useState<{
      tool: ChatToolUse;
      anchorRect: { left: number; top: number; right: number; bottom: number };
    } | null>(null);

    const errorCount = useMemo(
      () => tools.filter((t) => t.resultIsError).length,
      [tools],
    );

    const handleChipClick = useCallback(
      (tool: ChatToolUse, e: React.MouseEvent<HTMLButtonElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        setActiveTool({
          tool,
          anchorRect: {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
          },
        });
      },
      [],
    );

    const closePopover = useCallback(() => setActiveTool(null), []);

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          marginBottom: hasFollowingText ? 8 : 0,
          opacity: 0.78,
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          title={collapsed ? "ツール実行を表示" : "ツール実行を折りたたむ"}
          style={{
            background: "transparent",
            border: "none",
            color: colors.textSecondary,
            cursor: "pointer",
            padding: "2px 0",
            fontSize: 10,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            opacity: 0.85,
            alignSelf: "flex-start",
          }}
        >
          <span style={{ fontSize: 9 }}>{collapsed ? "▸" : "▾"}</span>
          <span>
            {tools.length} tool{tools.length === 1 ? "" : "s"}
          </span>
          {errorCount > 0 && (
            <span style={{ color: colors.danger, fontWeight: 600 }}>
              ({errorCount} error)
            </span>
          )}
        </button>
        {!collapsed && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {tools.map((t) => (
              <ToolUseChip key={t.id} tool={t} onClick={handleChipClick} />
            ))}
          </div>
        )}
        {activeTool && (
          <ToolDetailPopover
            tool={activeTool.tool}
            anchorRect={activeTool.anchorRect}
            onClose={closePopover}
          />
        )}
      </div>
    );
  },
);
ToolUseList.displayName = "ToolUseList";

interface ToolUseChipProps {
  tool: ChatToolUse;
  onClick: (tool: ChatToolUse, e: React.MouseEvent<HTMLButtonElement>) => void;
}

const ToolUseChip: React.FC<ToolUseChipProps> = React.memo(
  ({ tool, onClick }) => {
    const currentTheme = useCurrentTheme();
    const colors = currentTheme.colors;
    const summary = formatToolSummary(tool);
    const hasResult = tool.resultText !== null;
    const isError = tool.resultIsError;

    return (
      <button
        type="button"
        onClick={(e) => onClick(tool, e)}
        title="クリックで詳細を表示"
        style={{
          textAlign: "left",
          width: "100%",
          background: "transparent",
          border: `1px dashed ${
            isError ? `${colors.danger}80` : `${colors.border}`
          }`,
          borderRadius: 4,
          padding: "2px 6px",
          color: "inherit",
          fontFamily:
            '"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          fontSize: 10.5,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          lineHeight: 1.5,
        }}
      >
        <span style={{ fontWeight: 600, color: colors.textSecondary }}>
          {tool.name}
        </span>
        <span
          style={{
            opacity: 0.65,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          {summary}
        </span>
        {hasResult && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 9,
              opacity: 0.75,
              color: isError ? colors.danger : colors.textSecondary,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {isError ? "ERROR" : "OK"}
          </span>
        )}
      </button>
    );
  },
);
ToolUseChip.displayName = "ToolUseChip";

function formatToolSummary(tool: ChatToolUse): string {
  // よく使われるツール名は input から代表フィールドを抜き出して 1 行サマリーにする
  const input = tool.input;
  if (tool.name === "Bash") {
    const cmd = typeof input.command === "string" ? input.command : "";
    return cmd.length > 0 ? cmd : "(no command)";
  }
  if (tool.name === "Read" || tool.name === "Edit" || tool.name === "Write") {
    const fp = typeof input.file_path === "string" ? input.file_path : "";
    return fp;
  }
  if (tool.name === "Glob" || tool.name === "Grep") {
    const pattern = typeof input.pattern === "string" ? input.pattern : "";
    return pattern;
  }
  // その他は input の最初のフィールドを表示
  const firstKey = Object.keys(input)[0];
  if (!firstKey) return "";
  const v = input[firstKey];
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 80)}...` : v;
  return "";
}

function renderInline(text: string): React.ReactNode {
  const re = /`([^`\n]+)`/g;
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      out.push(text.slice(lastIndex, m.index));
    }
    out.push(
      <code
        key={`code-${key++}`}
        style={{
          background: "rgba(255,255,255,0.08)",
          padding: "1px 5px",
          borderRadius: 3,
          fontSize: "0.92em",
          fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
        }}
      >
        {m[1]}
      </code>,
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex));
  }
  return out;
}
