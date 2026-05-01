import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// trusted-dirs.ts は app.getPath を使うのでテストでは electron を mock する。
let userDataDir: string;

vi.mock("electron", () => ({
  app: {
    getPath: () => userDataDir,
  },
}));

// import は mock 後に行う必要があるため動的に行う
async function freshManager() {
  vi.resetModules();
  const mod = await import("../trusted-dirs");
  return mod.trustedDirsManager;
}

describe("TrustedDirsManager", () => {
  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trusted-dirs-test-"));
  });

  it("$HOME そのものは isHome=true で isTrusted=false", async () => {
    const m = await freshManager();
    const home = os.homedir();
    expect(m.isHome(home)).toBe(true);
    expect(m.isTrusted(home)).toBe(false);
    // trust しても永続化されない
    m.trust(home);
    expect(m.list()).not.toContain(home);
  });

  it("通常の CWD は trust 後に isTrusted=true", async () => {
    const m = await freshManager();
    const cwd = path.join(os.homedir(), "dev/some-project");
    expect(m.isTrusted(cwd)).toBe(false);
    m.trust(cwd);
    expect(m.isTrusted(cwd)).toBe(true);
  });

  it("trust は永続化され、再ロード後も保持される", async () => {
    const m1 = await freshManager();
    const cwd = path.join(os.homedir(), "dev/persisted");
    m1.trust(cwd);

    // 別インスタンスで再読込（同じ userDataDir）
    const m2 = await freshManager();
    expect(m2.isTrusted(cwd)).toBe(true);
  });

  it("空文字列 / null 相当は信頼されない", async () => {
    const m = await freshManager();
    expect(m.isTrusted("")).toBe(false);
    m.trust("");
    expect(m.list()).not.toContain("");
  });
});
