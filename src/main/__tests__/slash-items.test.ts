import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { listSlashItems } from "../slash-items";

// listSlashItems は ~/.claude/skills と <cwd>/.claude/skills を読みに行くので、
// テストでは fs モジュール自体は触らず、一時ディレクトリを CWD に渡して挙動を検証する。
// ~/.claude/skills 側はユーザー環境依存なので、命中しても落ちないように緩い検証にする。

describe("listSlashItems", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slash-items-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("常に builtin command を含む（/clear, /help, /init, /review, /security-review）", () => {
    const items = listSlashItems(tmpRoot);
    const labels = items
      .filter((i) => i.kind === "command")
      .map((i) => i.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "/clear",
        "/help",
        "/init",
        "/review",
        "/security-review",
      ]),
    );
  });

  it("project の .claude/skills 配下のディレクトリ名をスキル候補に追加する", () => {
    const skillDir = path.join(tmpRoot, ".claude", "skills", "my-test-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: my-test-skill\ndescription: テスト用スキルの説明\n---\n本文",
      "utf-8",
    );

    const items = listSlashItems(tmpRoot);
    const skill = items.find(
      (i) => i.kind === "skill" && i.label === "/my-test-skill",
    );
    expect(skill).toBeDefined();
    expect(skill?.scope).toBe("project");
    expect(skill?.description).toBe("テスト用スキルの説明");
  });

  it("ドット始まりのディレクトリは候補に含めない", () => {
    fs.mkdirSync(path.join(tmpRoot, ".claude", "skills", ".hidden"), {
      recursive: true,
    });
    const items = listSlashItems(tmpRoot);
    expect(items.find((i) => i.label === "/.hidden")).toBeUndefined();
  });

  it("SKILL.md が無いスキルは description 空のまま候補に出す", () => {
    const skillDir = path.join(tmpRoot, ".claude", "skills", "no-skill-md");
    fs.mkdirSync(skillDir, { recursive: true });
    const items = listSlashItems(tmpRoot);
    const skill = items.find((i) => i.label === "/no-skill-md");
    expect(skill).toBeDefined();
    expect(skill?.description).toBe("");
  });

  it("空 cwd でも builtin command は返る", () => {
    const items = listSlashItems("");
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.kind === "command" || i.kind === "skill")).toBe(
      true,
    );
  });

  it("project と global で同名なら project が優先される", () => {
    // global 側はテストで実際には作らない（ユーザー環境を汚さない）。
    // project 側に既存 global と同名のものを作ったときに project scope で出ることだけ確認。
    const skillDir = path.join(tmpRoot, ".claude", "skills", "code-review");
    fs.mkdirSync(skillDir, { recursive: true });
    const items = listSlashItems(tmpRoot);
    const matches = items.filter((i) => i.label === "/code-review");
    // 1 件のみ（重複していない）
    expect(matches.length).toBe(1);
    // project scope
    expect(matches[0].scope).toBe("project");
  });
});
