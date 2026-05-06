// Git 操作の renderer 側ストア。
//
// 設計:
// - 「アクティブな CWD」毎に独立した状態を持つ。CWD が切り替わったら refresh する。
// - 書き込み系の操作 (stage / commit / push 等) は `runOp` で wrap し、成功時に
//   自動 refresh、失敗時は toast を出すようにする。
// - 並行 refresh の race を避けるため、各 CWD ごとに `inflight` フラグで止める。

import { create } from "zustand";
import { showErrorToast } from "../components/Sidebar/ErrorToast";

export interface GitFile {
  path: string;
  index: string;
  workingDir: string;
  staged: boolean;
  modified: boolean;
  untracked: boolean;
  conflict: boolean;
}

export interface GitStatus {
  root: string;
  current: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
  isClean: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
  commit: string;
}

interface RepoState {
  cwd: string;
  status: GitStatus | null;
  branches: GitBranch[];
  loading: boolean;
  error: string | null;
}

interface GitStoreState {
  // CWD → repo state
  repos: Map<string, RepoState>;
  /** 指定 CWD の repo 状態をリフレッシュ。並行呼び出しは内部で merge */
  refresh: (cwd: string) => Promise<void>;
  /** 書き込み系操作: 成功なら refresh、失敗なら toast */
  runOp: <T>(
    cwd: string,
    op: () => Promise<{ ok: true } | { ok: false; error: string } | T>,
    opName: string,
  ) => Promise<boolean>;
  /** ストアから CWD のエントリを破棄 (ペイン閉鎖時) */
  forget: (cwd: string) => void;
}

function emptyState(cwd: string): RepoState {
  return { cwd, status: null, branches: [], loading: false, error: null };
}

export const useGitStore = create<GitStoreState>((set, get) => ({
  repos: new Map(),

  refresh: async (cwd: string) => {
    if (!cwd) return;
    const prev = get().repos.get(cwd) ?? emptyState(cwd);
    if (prev.loading) return;

    const next: RepoState = { ...prev, loading: true, error: null };
    const m = new Map(get().repos);
    m.set(cwd, next);
    set({ repos: m });

    // IPC が rejection / 例外を起こした場合に loading: true で固まらないよう
    // 必ず try/catch で wrap し、最後に loading: false で確定させる。
    try {
      const [statusRes, branchRes] = await Promise.all([
        window.api.git.status(cwd),
        window.api.git.branchList(cwd),
      ]);

      const updated: RepoState = {
        cwd,
        status: statusRes.ok ? statusRes.status : null,
        branches: branchRes.ok ? branchRes.branches : [],
        loading: false,
        error: !statusRes.ok ? statusRes.error : null,
      };
      const m2 = new Map(get().repos);
      m2.set(cwd, updated);
      set({ repos: m2 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 開発時の診断用にコンソールに残す (本番でも害はない)
      // eslint-disable-next-line no-console
      console.error("[gitStore.refresh] failed:", e);
      const errored: RepoState = {
        cwd,
        status: null,
        branches: [],
        loading: false,
        error: `git の読み込みに失敗: ${msg}`,
      };
      const m3 = new Map(get().repos);
      m3.set(cwd, errored);
      set({ repos: m3 });
    }
  },

  runOp: async (cwd, op, opName) => {
    try {
      const result = await op();
      if (
        typeof result === "object" &&
        result !== null &&
        "ok" in (result as Record<string, unknown>)
      ) {
        const r = result as { ok: boolean; error?: string };
        if (!r.ok) {
          showErrorToast(`${opName}に失敗: ${r.error ?? "unknown"}`);
          return false;
        }
      }
      // 自動 refresh
      await get().refresh(cwd);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showErrorToast(`${opName}に失敗: ${msg}`);
      return false;
    }
  },

  forget: (cwd: string) => {
    if (!get().repos.has(cwd)) return;
    const m = new Map(get().repos);
    m.delete(cwd);
    set({ repos: m });
  },
}));

/** 現在のリポジトリ状態を取得する小さな selector */
export function useGitRepo(cwd: string | null): RepoState | null {
  return useGitStore((s) => (cwd ? (s.repos.get(cwd) ?? null) : null));
}
