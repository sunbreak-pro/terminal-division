// Git 操作の中央窓口。simple-git のインスタンスを repo root ごとにキャッシュし、
// 主要操作 (status / branch / stage / commit / push / pull / fetch / diff) を提供する。
//
// 設計:
// - cwd は任意のパス。`resolveRoot(cwd)` で git の作業ツリールートに解決する。
// - simple-git は git が PATH に無い場合に reject する。エラーは簡潔な message に
//   統一して呼び出し側 (IPC) に返す。
// - 認証 (HTTPS / SSH) はユーザの既存 git 設定 (credential helper / ssh-agent) に
//   委ねる。本コードでは git config を変更しない。

import { simpleGit, type SimpleGit, type StatusResult } from "simple-git";

interface CachedRepo {
  root: string;
  git: SimpleGit;
}

// repo root → simple-git instance
const repoCache = new Map<string, CachedRepo>();

async function getGitForCwd(cwd: string): Promise<CachedRepo | null> {
  // 既にキャッシュ済みの root があるか (cwd がその配下なら使い回す)
  for (const [root, entry] of repoCache.entries()) {
    if (cwd === root || cwd.startsWith(root + "/")) {
      return entry;
    }
  }
  const probe = simpleGit(cwd);
  try {
    const root = (await probe.revparse(["--show-toplevel"])).trim();
    if (!root) return null;
    const cached = repoCache.get(root);
    if (cached) return cached;
    const entry = { root, git: simpleGit(root) };
    repoCache.set(root, entry);
    return entry;
  } catch {
    return null; // not a git repo
  }
}

export interface GitStatusFile {
  path: string;
  index: string; // staging area の状態 (例: "M" "A" "D" "?" " ")
  workingDir: string; // 作業ツリーの状態
  staged: boolean;
  modified: boolean;
  untracked: boolean;
  conflict: boolean;
}

export interface GitStatusResult {
  root: string;
  current: string | null; // ブランチ名 (detached なら null)
  tracking: string | null; // upstream branch
  ahead: number;
  behind: number;
  files: GitStatusFile[];
  isClean: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean; // origin/foo 等のリモート tracking branch か
  commit: string;
}

function summarizeStatus(root: string, s: StatusResult): GitStatusResult {
  const files: GitStatusFile[] = s.files.map((f) => {
    const index = f.index || " ";
    const workingDir = f.working_dir || " ";
    const conflict =
      index === "U" ||
      workingDir === "U" ||
      (index === "A" && workingDir === "A");
    const staged = index !== " " && index !== "?" && !conflict;
    const untracked = index === "?" && workingDir === "?";
    const modified = !untracked && (workingDir !== " " || conflict);
    return {
      path: f.path,
      index,
      workingDir,
      staged,
      modified,
      untracked,
      conflict,
    };
  });
  return {
    root,
    current: s.current ?? null,
    tracking: s.tracking ?? null,
    ahead: s.ahead ?? 0,
    behind: s.behind ?? 0,
    files,
    isClean: files.length === 0,
  };
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

class GitManager {
  /** cwd が git 管理下なら作業ツリーの root を返す。それ以外は null */
  async resolveRoot(cwd: string): Promise<string | null> {
    const entry = await getGitForCwd(cwd);
    return entry?.root ?? null;
  }

  async status(
    cwd: string,
  ): Promise<
    { ok: true; status: GitStatusResult } | { ok: false; error: string }
  > {
    const entry = await getGitForCwd(cwd);
    if (!entry) return { ok: false, error: "not a git repository" };
    try {
      const s = await entry.git.status();
      return { ok: true, status: summarizeStatus(entry.root, s) };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }

  async branchList(
    cwd: string,
  ): Promise<
    { ok: true; branches: GitBranch[] } | { ok: false; error: string }
  > {
    const entry = await getGitForCwd(cwd);
    if (!entry) return { ok: false, error: "not a git repository" };
    try {
      const result = await entry.git.branch(["-a"]);
      const branches: GitBranch[] = [];
      for (const [name, info] of Object.entries(result.branches)) {
        // remotes/origin/HEAD のような alias は除外
        if (name.endsWith("/HEAD") || info.label?.startsWith("-> ")) continue;
        branches.push({
          name,
          current: info.current,
          remote: name.startsWith("remotes/"),
          commit: info.commit,
        });
      }
      return { ok: true, branches };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }

  async branchCreate(
    cwd: string,
    name: string,
    from?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!name || name.includes(" ") || /[\x00-\x1f~^:?*[\\]/.test(name)) {
      return { ok: false, error: "invalid branch name" };
    }
    const entry = await getGitForCwd(cwd);
    if (!entry) return { ok: false, error: "not a git repository" };
    try {
      await entry.git.branch(from ? [name, from] : [name]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }

  async branchDelete(
    cwd: string,
    name: string,
    force = false,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const entry = await getGitForCwd(cwd);
    if (!entry) return { ok: false, error: "not a git repository" };
    try {
      const flag = force ? "-D" : "-d";
      await entry.git.branch([flag, name]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }

  async branchSwitch(
    cwd: string,
    name: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const entry = await getGitForCwd(cwd);
    if (!entry) return { ok: false, error: "not a git repository" };
    try {
      // remotes/origin/foo を渡されたら先頭を剥がす (checkout は短い形を要求)
      const target = name.replace(/^remotes\/[^/]+\//, "");
      await entry.git.checkout(target);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }

  async stage(
    cwd: string,
    paths: string[],
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (paths.length === 0) return { ok: true };
    const entry = await getGitForCwd(cwd);
    if (!entry) return { ok: false, error: "not a git repository" };
    try {
      await entry.git.add(paths);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }

  async unstage(
    cwd: string,
    paths: string[],
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (paths.length === 0) return { ok: true };
    const entry = await getGitForCwd(cwd);
    if (!entry) return { ok: false, error: "not a git repository" };
    try {
      await entry.git.reset(["HEAD", "--", ...paths]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }

  async commit(
    cwd: string,
    message: string,
  ): Promise<{ ok: true; commit: string } | { ok: false; error: string }> {
    if (!message.trim()) return { ok: false, error: "commit message required" };
    const entry = await getGitForCwd(cwd);
    if (!entry) return { ok: false, error: "not a git repository" };
    try {
      const result = await entry.git.commit(message);
      return { ok: true, commit: result.commit };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }

  async push(
    cwd: string,
    remote?: string,
    branch?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const entry = await getGitForCwd(cwd);
    if (!entry) return { ok: false, error: "not a git repository" };
    try {
      if (remote && branch) await entry.git.push(remote, branch);
      else await entry.git.push();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }

  async pull(
    cwd: string,
    remote?: string,
    branch?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const entry = await getGitForCwd(cwd);
    if (!entry) return { ok: false, error: "not a git repository" };
    try {
      if (remote && branch) await entry.git.pull(remote, branch);
      else await entry.git.pull();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }

  async fetch(
    cwd: string,
    remote?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const entry = await getGitForCwd(cwd);
    if (!entry) return { ok: false, error: "not a git repository" };
    try {
      if (remote) await entry.git.fetch(remote);
      else await entry.git.fetch();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }

  async diff(
    cwd: string,
    path?: string,
    staged = false,
  ): Promise<{ ok: true; diff: string } | { ok: false; error: string }> {
    const entry = await getGitForCwd(cwd);
    if (!entry) return { ok: false, error: "not a git repository" };
    try {
      const args: string[] = [];
      if (staged) args.push("--cached");
      if (path) {
        args.push("--", path);
      }
      const out = await entry.git.diff(args);
      return { ok: true, diff: out };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }
}

export const gitManager = new GitManager();
