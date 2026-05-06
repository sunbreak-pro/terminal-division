// Git 操作パネル。サイドバー Git タブが選ばれている時に rootPath (CWD) を受け取って
// 表示する。簡素な縦スクロール 1 カラム構成:
//   [branch indicator] (現在ブランチ + ahead/behind + ⟳)
//   [操作ボタン群] (Push / Pull / Fetch / 新規ブランチ)
//   [変更ファイル一覧]
//      Staged  → unstage チェックボックス、クリックで diff (--cached)
//      Modified/Untracked → stage チェックボックス、クリックで diff
//   [commit message + Commit ボタン]
//   [branch list] (折り畳み式: 切替 / 削除)
//   [diff modal] (path 表示 → "git diff" のテキストを <pre> で出す)

import React, { useEffect, useMemo, useState } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";
import { useGitStore, useGitRepo } from "../../stores/gitStore";
import { showErrorToast } from "./ErrorToast";

interface GitPanelProps {
  cwd: string;
}

export const GitPanel: React.FC<GitPanelProps> = ({ cwd }) => {
  const theme = useCurrentTheme();
  const config = useThemeConfig();
  const repo = useGitRepo(cwd);
  const refresh = useGitStore((s) => s.refresh);
  const runOp = useGitStore((s) => s.runOp);

  const [commitMsg, setCommitMsg] = useState("");
  const [showBranches, setShowBranches] = useState(false);
  const [diffTarget, setDiffTarget] = useState<{
    path: string;
    staged: boolean;
  } | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [diffLoading, setDiffLoading] = useState(false);

  // CWD 切替で初回 + 再描画ごとに refresh を発火 (cwd, refresh は stable)
  useEffect(() => {
    void refresh(cwd);
  }, [cwd, refresh]);

  // diff modal を開いた時にロード
  useEffect(() => {
    if (!diffTarget) return;
    setDiffLoading(true);
    setDiffText("");
    void window.api.git
      .diff(cwd, diffTarget.path, diffTarget.staged)
      .then((res) => {
        if (res.ok) setDiffText(res.diff || "(差分なし)");
        else setDiffText(`(エラー: ${res.error})`);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setDiffText(`(エラー: ${msg})`);
      })
      .finally(() => setDiffLoading(false));
  }, [diffTarget, cwd]);

  const status = repo?.status;
  const branches = repo?.branches ?? [];
  const error = repo?.error;
  const loading = repo?.loading ?? false;

  const staged = useMemo(
    () => status?.files.filter((f) => f.staged) ?? [],
    [status],
  );
  const unstaged = useMemo(
    () => status?.files.filter((f) => !f.staged) ?? [],
    [status],
  );

  const localBranches = branches.filter((b) => !b.remote);
  const remoteBranches = branches.filter((b) => b.remote);

  if (!repo || (loading && !status && !error)) {
    return (
      <div
        style={{
          padding: 12,
          fontSize: 12,
          color: theme.colors.textSecondary,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div>Git 情報を読み込み中…</div>
        <button
          type="button"
          onClick={() => void refresh(cwd)}
          style={{
            alignSelf: "flex-start",
            padding: "4px 10px",
            fontSize: 11,
            backgroundColor: "transparent",
            color: theme.colors.text,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: 4,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          再読込
        </button>
        <div style={{ fontSize: 10, opacity: 0.6 }}>
          DevTools のコンソールにエラー詳細が出る場合があります
        </div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div
        style={{
          padding: 12,
          fontSize: 12,
          color: theme.colors.textSecondary,
        }}
      >
        この CWD は Git リポジトリではありません
        <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>{cwd}</div>
      </div>
    );
  }

  const handleStage = async (paths: string[]): Promise<void> => {
    await runOp(cwd, () => window.api.git.stage(cwd, paths), "ステージ");
  };
  const handleUnstage = async (paths: string[]): Promise<void> => {
    await runOp(cwd, () => window.api.git.unstage(cwd, paths), "アンステージ");
  };
  const handleCommit = async (): Promise<void> => {
    if (!commitMsg.trim()) {
      showErrorToast("コミットメッセージを入力してください");
      return;
    }
    if (staged.length === 0) {
      showErrorToast("ステージされた変更がありません");
      return;
    }
    const ok = await runOp(
      cwd,
      () => window.api.git.commit(cwd, commitMsg),
      "コミット",
    );
    if (ok) setCommitMsg("");
  };
  const handlePush = (): void => {
    void runOp(cwd, () => window.api.git.push(cwd), "push");
  };
  const handlePull = (): void => {
    void runOp(cwd, () => window.api.git.pull(cwd), "pull");
  };
  const handleFetch = (): void => {
    void runOp(cwd, () => window.api.git.fetch(cwd), "fetch");
  };
  const handleSwitch = async (name: string): Promise<void> => {
    await runOp(
      cwd,
      () => window.api.git.branchSwitch(cwd, name),
      `${name} へ切替`,
    );
  };
  const handleCreateBranch = async (): Promise<void> => {
    const name = window.prompt("新しいブランチ名:");
    if (!name) return;
    const ok = await runOp(
      cwd,
      () => window.api.git.branchCreate(cwd, name.trim()),
      "ブランチ作成",
    );
    if (ok) {
      const switchOk = await runOp(
        cwd,
        () => window.api.git.branchSwitch(cwd, name.trim()),
        `${name} へ切替`,
      );
      if (!switchOk) showErrorToast("作成は成功、切替に失敗しました");
    }
  };
  const handleDeleteBranch = async (name: string): Promise<void> => {
    const force = window.confirm(
      `ブランチ ${name} を削除しますか?\n(マージ済みでない場合は強制削除になります)`,
    );
    if (!force) return;
    await runOp(
      cwd,
      () => window.api.git.branchDelete(cwd, name, true),
      "ブランチ削除",
    );
  };

  const fileLabel = (f: {
    index: string;
    workingDir: string;
    untracked: boolean;
    conflict: boolean;
  }): string => {
    if (f.conflict) return "!";
    if (f.untracked) return "U";
    if (f.index !== " " && f.index !== "?") return f.index;
    return f.workingDir;
  };

  const buttonStyle: React.CSSProperties = {
    padding: "4px 10px",
    fontSize: 11,
    backgroundColor: "transparent",
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: 4,
    cursor: "pointer",
    fontFamily: "inherit",
  };
  const primaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: theme.colors.activeTerminal,
    color: theme.colors.background,
    border: "none",
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 8,
        fontSize: 12,
      }}
    >
      {/* Branch + ahead/behind + refresh */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 6px",
          borderBottom: `1px solid ${theme.colors.border}`,
          paddingBottom: 8,
        }}
      >
        <span
          style={{
            fontWeight: 600,
            color: theme.colors.activeTerminal,
            cursor: "pointer",
          }}
          title="ブランチを切替"
          onClick={() => setShowBranches((v) => !v)}
        >
          ⎇ {status.current ?? "(detached)"}
        </span>
        {status.tracking && (
          <span style={{ opacity: 0.6 }}>→ {status.tracking}</span>
        )}
        {status.ahead > 0 && <span title="ahead">↑{status.ahead}</span>}
        {status.behind > 0 && <span title="behind">↓{status.behind}</span>}
        <button
          type="button"
          onClick={() => void refresh(cwd)}
          style={{
            ...buttonStyle,
            marginLeft: "auto",
            padding: "2px 6px",
          }}
          title="再読み込み"
        >
          ⟳
        </button>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" style={buttonStyle} onClick={handleFetch}>
          Fetch
        </button>
        <button type="button" style={buttonStyle} onClick={handlePull}>
          Pull
        </button>
        <button type="button" style={buttonStyle} onClick={handlePush}>
          Push
        </button>
        <button type="button" style={buttonStyle} onClick={handleCreateBranch}>
          + Branch
        </button>
      </div>

      {/* Branch list (toggle) */}
      {showBranches && (
        <div
          style={{
            border: `1px solid ${theme.colors.border}`,
            borderRadius: 4,
            padding: 6,
            maxHeight: 200,
            overflow: "auto",
          }}
        >
          <div
            style={{
              fontSize: 10,
              opacity: 0.7,
              marginBottom: 4,
              textTransform: "uppercase",
            }}
          >
            local
          </div>
          {localBranches.map((b) => (
            <div
              key={b.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 0",
              }}
            >
              <span
                style={{
                  flex: 1,
                  cursor: b.current ? "default" : "pointer",
                  fontWeight: b.current ? 600 : 400,
                  color: b.current
                    ? theme.colors.activeTerminal
                    : theme.colors.text,
                }}
                onClick={() => !b.current && void handleSwitch(b.name)}
                title={b.current ? "現在のブランチ" : "クリックで切替"}
              >
                {b.current ? "● " : "  "}
                {b.name}
              </span>
              {!b.current && (
                <button
                  type="button"
                  onClick={() => void handleDeleteBranch(b.name)}
                  style={{
                    ...buttonStyle,
                    padding: "1px 6px",
                    fontSize: 10,
                    color: theme.colors.danger,
                  }}
                >
                  削除
                </button>
              )}
            </div>
          ))}
          {remoteBranches.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 10,
                  opacity: 0.7,
                  marginTop: 6,
                  marginBottom: 4,
                  textTransform: "uppercase",
                }}
              >
                remote
              </div>
              {remoteBranches.map((b) => (
                <div
                  key={b.name}
                  style={{ padding: "2px 0", opacity: 0.85 }}
                  title="クリックで checkout (短縮形)"
                >
                  <span
                    style={{ cursor: "pointer" }}
                    onClick={() => void handleSwitch(b.name)}
                  >
                    {b.name}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Staged: 縦リサイズ可能なスクロール領域に格納する。
          CSS resize: vertical はフォーム要素以外の任意 block にも効くが、
          overflow が visible でない場合に限り表示される。 */}
      <div
        style={{
          resize: "vertical",
          overflow: "auto",
          minHeight: 80,
          height: 160,
          maxHeight: "60vh",
          border: `1px solid ${theme.colors.border}`,
          borderRadius: 4,
          padding: 6,
          // セクション内の行が短い時にも resize ハンドル分の余白が残るように
          paddingBottom: 12,
        }}
      >
        <FileSection
          title={`Staged (${staged.length})`}
          files={staged}
          onToggle={(p) => void handleUnstage([p])}
          onClickName={(p) => setDiffTarget({ path: p, staged: true })}
          toggleLabel="アンステージ"
          labelOf={fileLabel}
          theme={theme}
        />
      </div>

      {/* Commit */}
      <textarea
        value={commitMsg}
        onChange={(e) => setCommitMsg(e.target.value)}
        placeholder="コミットメッセージ"
        rows={2}
        style={{
          background: theme.colors.background,
          color: theme.colors.text,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: 4,
          padding: 6,
          fontSize: 12,
          fontFamily: "inherit",
          resize: "vertical",
        }}
      />
      <button
        type="button"
        onClick={() => void handleCommit()}
        style={primaryButtonStyle}
        disabled={staged.length === 0}
      >
        コミット ({staged.length})
      </button>

      {/* Unstaged / Untracked: Staged と同様にリサイズ可能領域に格納 */}
      <div
        style={{
          resize: "vertical",
          overflow: "auto",
          minHeight: 80,
          height: 240,
          maxHeight: "60vh",
          border: `1px solid ${theme.colors.border}`,
          borderRadius: 4,
          padding: 6,
          paddingBottom: 12,
        }}
      >
        <FileSection
          title={`変更 (${unstaged.length})`}
          files={unstaged}
          onToggle={(p) => void handleStage([p])}
          onClickName={(p) => setDiffTarget({ path: p, staged: false })}
          toggleLabel="ステージ"
          labelOf={fileLabel}
          theme={theme}
        />
      </div>

      {/* Diff modal */}
      {diffTarget && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setDiffTarget(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: theme.colors.headerBackground,
              color: theme.colors.text,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: 8,
              padding: 12,
              maxWidth: "90vw",
              maxHeight: "85vh",
              width: 900,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 600 }}>
                {diffTarget.staged ? "Staged diff" : "Working diff"}
              </span>
              <span style={{ opacity: 0.7 }}>{diffTarget.path}</span>
              <button
                type="button"
                onClick={() => setDiffTarget(null)}
                style={{ ...buttonStyle, marginLeft: "auto" }}
              >
                閉じる
              </button>
            </div>
            <pre
              style={{
                flex: 1,
                overflow: "auto",
                background: theme.colors.background,
                color: theme.colors.text,
                padding: 8,
                fontSize: 12,
                fontFamily:
                  '"Menlo", "Monaco", "SFMono-Regular", "Courier New", monospace',
                whiteSpace: "pre",
                margin: 0,
              }}
            >
              {diffLoading ? "(読み込み中…)" : diffText}
            </pre>
          </div>
        </div>
      )}

      {/* sidebar config 参照のための noop。VSCode と異なり minimal */}
      <div style={{ flex: 1, minHeight: 8 }} />
      <div style={{ fontSize: 10, opacity: 0.5 }}>
        repo: {status.root}
        <span style={{ marginLeft: 4 }}>{config.spacing ? "" : ""}</span>
      </div>
    </div>
  );
};

interface FileSectionProps {
  title: string;
  files: {
    path: string;
    index: string;
    workingDir: string;
    untracked: boolean;
    conflict: boolean;
  }[];
  onToggle: (path: string) => void;
  onClickName: (path: string) => void;
  toggleLabel: string;
  labelOf: (f: {
    index: string;
    workingDir: string;
    untracked: boolean;
    conflict: boolean;
  }) => string;
  theme: ReturnType<typeof useCurrentTheme>;
}

const FileSection: React.FC<FileSectionProps> = ({
  title,
  files,
  onToggle,
  onClickName,
  toggleLabel,
  labelOf,
  theme,
}) => {
  if (files.length === 0) {
    return <div style={{ fontSize: 11, opacity: 0.5 }}>{title} — 変更なし</div>;
  }
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          marginBottom: 4,
          opacity: 0.85,
        }}
      >
        {title}
      </div>
      {files.map((f) => (
        <div
          key={f.path}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "2px 0",
          }}
        >
          <button
            type="button"
            onClick={() => onToggle(f.path)}
            title={toggleLabel}
            style={{
              padding: "1px 6px",
              fontSize: 10,
              backgroundColor: "transparent",
              color: theme.colors.textSecondary,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: 3,
              cursor: "pointer",
              fontFamily: "inherit",
              minWidth: 22,
            }}
          >
            ±
          </button>
          <span
            style={{
              fontFamily:
                '"Menlo", "Monaco", "SFMono-Regular", "Courier New", monospace',
              fontSize: 10,
              width: 16,
              color: f.conflict
                ? theme.colors.danger
                : theme.colors.textSecondary,
              flexShrink: 0,
              textAlign: "center",
            }}
          >
            {labelOf(f)}
          </span>
          <span
            onClick={() => onClickName(f.path)}
            style={{
              flex: 1,
              cursor: "pointer",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={`${f.path} (クリックで diff)`}
          >
            {f.path}
          </span>
        </div>
      ))}
    </div>
  );
};
