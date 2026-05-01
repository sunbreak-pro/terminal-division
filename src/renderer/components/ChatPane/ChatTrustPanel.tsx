import React from "react";
import { useCurrentTheme } from "../../stores/themeStore";

interface ChatTrustPanelProps {
  cwd: string;
  // $HOME そのものか。true のとき毎回確認するため永続化されない旨を表示。
  isHome: boolean;
  onTrust: () => void;
  onCancel: () => void;
}

/**
 * Chat 起動前の信頼確認パネル（インライン）。
 * 元々は Modal だったが、ペイン内 absolute コンテナ × position:fixed の
 * 組合せで描画されない環境があったため、welcome と同じレイヤーに置く。
 *
 * - 信頼済み CWD では呼び出し側で到達しないため本コンポーネントは描画されない
 * - $HOME そのもの: 毎回確認される旨を強調表示
 * - それ以外: 一度信頼すると次回以降確認されない
 */
const ChatTrustPanel: React.FC<ChatTrustPanelProps> = React.memo(
  ({ cwd, isHome, onTrust, onCancel }) => {
    const currentTheme = useCurrentTheme();
    const colors = currentTheme.colors;

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
        }}
      >
        <div
          aria-hidden
          style={{
            width: 52,
            height: 52,
            borderRadius: 12,
            background: `${colors.accent}1f`,
            border: `1px solid ${colors.accent}55`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: colors.accent,
            fontSize: 26,
            fontWeight: 700,
          }}
        >
          ⚠
        </div>

        <div
          style={{
            color: colors.text,
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          このディレクトリを信頼しますか？
        </div>

        <div
          style={{
            color: colors.text,
            fontSize: 12.5,
            wordBreak: "break-all",
            fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
            background: colors.headerBackground,
            padding: "6px 10px",
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            maxWidth: 420,
          }}
          title={cwd}
        >
          {cwd || "(空)"}
        </div>

        <div
          style={{
            color: colors.textSecondary,
            fontSize: 12.5,
            lineHeight: 1.6,
            maxWidth: 420,
          }}
        >
          Claude がこの配下のファイルを読み書きできるようになります。
          {isHome ? (
            <>
              <br />
              <span style={{ color: colors.danger, fontWeight: 600 }}>
                ※
                ホームディレクトリ直下のため信頼設定は永続化されません（毎回確認されます）
              </span>
            </>
          ) : (
            <>
              <br />
              一度信頼すると次回以降このディレクトリで確認されません。
            </>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "6px 16px",
              backgroundColor: "transparent",
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onTrust}
            autoFocus
            style={{
              padding: "6px 18px",
              backgroundColor: colors.accent,
              color: colors.background,
              border: `1px solid ${colors.accent}`,
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
            }}
          >
            信頼する
          </button>
        </div>
      </div>
    );
  },
);

ChatTrustPanel.displayName = "ChatTrustPanel";

export { ChatTrustPanel };
