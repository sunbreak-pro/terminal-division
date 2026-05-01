import fs from "fs";
import path from "path";
import os from "os";

// chat 入力欄で `/` 入力時に表示する候補。
// 種別: "command"（Claude Code 組込みのスラッシュコマンド）と "skill"（~/.claude/skills 配下）。
// description は SKILL.md の YAML frontmatter から best-effort で抜き出す。

export type SlashScope = "global" | "project" | "builtin";
export interface SlashItem {
  // textarea に挿入する文字列（先頭の `/` を含む）
  insert: string;
  // 表示名（先頭 `/` を含む）
  label: string;
  // 短い説明（80 文字程度に切詰め）。空のことがある。
  description: string;
  scope: SlashScope;
  kind: "command" | "skill";
}

// Claude Code に組込みで存在しがちなコマンド。MVP では固定リスト。
// /clear だけはローカル CLI 側でしか効かないが、視認性のため候補に出す。
const BUILTIN_COMMANDS: SlashItem[] = [
  {
    insert: "/clear",
    label: "/clear",
    description: "会話履歴をクリア（CLI セッション）",
    scope: "builtin",
    kind: "command",
  },
  {
    insert: "/help",
    label: "/help",
    description: "Claude Code のヘルプを表示",
    scope: "builtin",
    kind: "command",
  },
  {
    insert: "/init",
    label: "/init",
    description: "CLAUDE.md を初期化",
    scope: "builtin",
    kind: "command",
  },
  {
    insert: "/review",
    label: "/review",
    description: "プルリクエストをレビュー",
    scope: "builtin",
    kind: "command",
  },
  {
    insert: "/security-review",
    label: "/security-review",
    description: "現在の差分のセキュリティレビュー",
    scope: "builtin",
    kind: "command",
  },
];

function readSkillDescription(skillDir: string): string {
  // SKILL.md の YAML frontmatter から `description:` を抽出する。
  // 失敗 / 不存在は空文字を返す。読み込みは 16KB 上限で打ち切り。
  try {
    const skillFile = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillFile)) return "";
    const stat = fs.statSync(skillFile);
    if (!stat.isFile()) return "";
    const fd = fs.openSync(skillFile, "r");
    const buf = Buffer.alloc(Math.min(stat.size, 16 * 1024));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const text = buf.toString("utf-8");
    // frontmatter は --- で囲まれる
    const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return "";
    const fm = match[1];
    // description: の値を 1 行 or block scalar で抽出
    const desc = fm.match(/^description:\s*(.+)$/m);
    if (!desc) return "";
    return desc[1]
      .trim()
      .replace(/^["']|["']$/g, "")
      .slice(0, 120);
  } catch {
    return "";
  }
}

function listSkillsInDir(dir: string, scope: SlashScope): SlashItem[] {
  if (!fs.existsSync(dir)) return [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const items: SlashItem[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    let isDir = false;
    try {
      isDir = fs.statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const description = readSkillDescription(full);
    items.push({
      insert: `/${name}`,
      label: `/${name}`,
      description,
      scope,
      kind: "skill",
    });
  }
  return items;
}

/**
 * project の `<cwd>/.claude/skills/` と global の `~/.claude/skills/` から候補を集める。
 * project と global で同名なら project を優先（一覧では project を先に出す）。
 * 結果は label の昇順でカテゴリ別にソート。
 */
export function listSlashItems(cwd: string): SlashItem[] {
  const home = os.homedir();
  const globalSkills = listSkillsInDir(
    path.join(home, ".claude", "skills"),
    "global",
  );
  const projectSkills = cwd
    ? listSkillsInDir(path.join(cwd, ".claude", "skills"), "project")
    : [];

  // 同名は project 優先で重複排除
  const seen = new Set<string>();
  const dedupedProject = projectSkills.filter((s) => {
    if (seen.has(s.label)) return false;
    seen.add(s.label);
    return true;
  });
  const dedupedGlobal = globalSkills.filter((s) => {
    if (seen.has(s.label)) return false;
    seen.add(s.label);
    return true;
  });

  const sortByLabel = (a: SlashItem, b: SlashItem): number =>
    a.label.localeCompare(b.label);
  return [
    ...BUILTIN_COMMANDS.slice().sort(sortByLabel),
    ...dedupedProject.sort(sortByLabel),
    ...dedupedGlobal.sort(sortByLabel),
  ];
}
