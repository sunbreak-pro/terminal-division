import { describe, it, expect, beforeEach, vi } from "vitest";
import { useGitStore } from "../gitStore";

const gitMocks = (): {
  status: ReturnType<typeof vi.fn>;
  branchList: ReturnType<typeof vi.fn>;
  stage: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
} => ({
  status: window.api.git.status as unknown as ReturnType<typeof vi.fn>,
  branchList: window.api.git.branchList as unknown as ReturnType<typeof vi.fn>,
  stage: window.api.git.stage as unknown as ReturnType<typeof vi.fn>,
  commit: window.api.git.commit as unknown as ReturnType<typeof vi.fn>,
});

const sampleStatus = {
  ok: true as const,
  status: {
    root: "/work/repo",
    current: "main",
    tracking: "origin/main",
    ahead: 1,
    behind: 0,
    files: [
      {
        path: "src/foo.ts",
        index: " ",
        workingDir: "M",
        staged: false,
        modified: true,
        untracked: false,
        conflict: false,
      },
      {
        path: "src/bar.ts",
        index: "A",
        workingDir: " ",
        staged: true,
        modified: false,
        untracked: false,
        conflict: false,
      },
    ],
    isClean: false,
  },
};

const resetStore = (): void => {
  useGitStore.setState({ repos: new Map() });
};

describe("gitStore", () => {
  beforeEach(() => {
    resetStore();
    const m = gitMocks();
    m.status.mockReset();
    m.branchList.mockReset();
    m.stage.mockReset();
    m.commit.mockReset();
    m.status.mockResolvedValue(sampleStatus);
    m.branchList.mockResolvedValue({
      ok: true,
      branches: [
        { name: "main", current: true, remote: false, commit: "abc" },
        { name: "dev", current: false, remote: false, commit: "def" },
      ],
    });
    m.stage.mockResolvedValue({ ok: true });
    m.commit.mockResolvedValue({ ok: true, commit: "xyz" });
  });

  it("refresh が status / branchList を並列で呼んで state にセットする", async () => {
    await useGitStore.getState().refresh("/work/repo");
    const repo = useGitStore.getState().repos.get("/work/repo");
    expect(repo?.status?.current).toBe("main");
    expect(repo?.branches.map((b) => b.name)).toEqual(["main", "dev"]);
    expect(repo?.loading).toBe(false);
    expect(repo?.error).toBeNull();
  });

  it("status が失敗したら error にセットされる", async () => {
    gitMocks().status.mockResolvedValueOnce({
      ok: false,
      error: "not a git repository",
    });
    await useGitStore.getState().refresh("/no-repo");
    const repo = useGitStore.getState().repos.get("/no-repo");
    expect(repo?.status).toBeNull();
    expect(repo?.error).toBe("not a git repository");
  });

  it("loading 中は二重 refresh が抑制される", async () => {
    // 1 回目を保留させる。TS の制御フロー解析が Promise コンストラクタ内の代入を
    // 追えないため、`resolveStatus` の型は any 経由で広めに保持する。
    let resolveStatus: ((v: typeof sampleStatus) => void) | null = null;
    gitMocks().status.mockImplementationOnce(
      () =>
        new Promise<typeof sampleStatus>((res) => {
          resolveStatus = res;
        }),
    );
    const p1 = useGitStore.getState().refresh("/work/repo");
    // 2 回目: 即時 return
    await useGitStore.getState().refresh("/work/repo");
    expect(gitMocks().status).toHaveBeenCalledTimes(1);
    // TS は Promise コンストラクタ内の代入を追えないため明示 cast
    (resolveStatus as ((v: typeof sampleStatus) => void) | null)?.(
      sampleStatus,
    );
    await p1;
  });

  it("runOp 成功時に refresh が走る", async () => {
    const ok = await useGitStore
      .getState()
      .runOp(
        "/work/repo",
        () => window.api.git.stage("/work/repo", ["foo.ts"]),
        "ステージ",
      );
    expect(ok).toBe(true);
    expect(gitMocks().status).toHaveBeenCalled();
  });

  it("runOp 失敗時は false を返し refresh しない", async () => {
    gitMocks().stage.mockResolvedValueOnce({ ok: false, error: "boom" });
    const ok = await useGitStore
      .getState()
      .runOp(
        "/work/repo",
        () => window.api.git.stage("/work/repo", ["foo.ts"]),
        "ステージ",
      );
    expect(ok).toBe(false);
    expect(gitMocks().status).not.toHaveBeenCalled();
  });

  it("forget で entry が消える", async () => {
    await useGitStore.getState().refresh("/work/repo");
    expect(useGitStore.getState().repos.has("/work/repo")).toBe(true);
    useGitStore.getState().forget("/work/repo");
    expect(useGitStore.getState().repos.has("/work/repo")).toBe(false);
  });
});
