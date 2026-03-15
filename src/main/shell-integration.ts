import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";

// 統合用一時ディレクトリ（遅延初期化、シングルトン）
let integrationDir: string | null = null;

// zsh用 .zshenv: ユーザーのZDOTDIRを復元し、統合ディレクトリに戻す
function createZshenv(origZdotdir: string): string {
  return `# Terminal Division shell integration
__TD_ORIG_ZDOTDIR="${origZdotdir}"
ZDOTDIR="${origZdotdir}"
[[ -f "\${ZDOTDIR}/.zshenv" ]] && source "\${ZDOTDIR}/.zshenv"
ZDOTDIR="${getOrCreateIntegrationDir()}"
`;
}

// zsh用 .zshrc: ユーザーの.zshrcを読み込み、precmdフックを登録
// OSC 7770プロトコル: A=プロンプト開始、D;N=コマンド完了（N=exit code）
function createZshrc(origZdotdir: string): string {
  return `# Terminal Division shell integration
ZDOTDIR="${origZdotdir}"
[[ -f "\${ZDOTDIR}/.zshrc" ]] && source "\${ZDOTDIR}/.zshrc"

# 状態管理
__td_last_exit=0
__td_has_run_command=0

# Exit codeキャプチャ + コマンド完了マーカー送信（precmd_functionsの先頭）
__td_precmd() {
  __td_last_exit=$?
  if [[ $__td_has_run_command -eq 1 ]]; then
    printf '\\e]7770;D;%d\\a' "$__td_last_exit"
    __td_has_run_command=0
  fi
  printf '\\e]7;file://%s%s\\a' "\${HOST}" "\${PWD}"
  printf '\\e]7770;A\\a'
  return $__td_last_exit
}

# コマンド開始マーカー（preexec = Enter押下後、実行前。空Enterでは発火しない）
__td_preexec() {
  __td_has_run_command=1
}

# プロンプト修正（precmd_functionsの末尾 = conda等の後に実行）
# 常にグレー●を表示（色更新はレンダラー側のデコレーションで行う）
__td_prompt_status() {
  PROMPT="\${PROMPT#%F\\{242\\}● %f}"
  PROMPT="\${PROMPT#%F\\{green\\}● %f}"
  PROMPT="\${PROMPT#%F\\{red\\}● %f}"
  PROMPT="%F{242}● %f\${PROMPT}"
}

precmd_functions=(__td_precmd "\${precmd_functions[@]}")
precmd_functions+=(__td_prompt_status)
preexec_functions=(__td_preexec "\${preexec_functions[@]}")
`;
}

// bash用 .bashrc
// 注意: PS1のglobパターン問題を回避するため、変数を使った完全一致比較で前回のドットを除去
// bashにはpreexecがないため、空Enterでも D;N が送信される（同色に再更新されるだけで視覚変化なし）
function createBashrc(): string {
  return `# Terminal Division shell integration
[[ -f "$HOME/.bashrc" ]] && source "$HOME/.bashrc"

__td_first_prompt=1

__td_prompt_command() {
  local e=$?
  local gray_dot='\\[\\033[38;5;242m\\]● \\[\\033[0m\\]'
  local green_dot='\\[\\033[32m\\]● \\[\\033[0m\\]'
  local red_dot='\\[\\033[31m\\]● \\[\\033[0m\\]'

  # 前のドットを除去
  if [[ "$PS1" == "$green_dot"* ]]; then
    PS1="\${PS1#"$green_dot"}"
  elif [[ "$PS1" == "$red_dot"* ]]; then
    PS1="\${PS1#"$red_dot"}"
  elif [[ "$PS1" == "$gray_dot"* ]]; then
    PS1="\${PS1#"$gray_dot"}"
  fi

  # コマンド完了マーカー（初回プロンプトはスキップ）
  if [[ $__td_first_prompt -eq 1 ]]; then
    __td_first_prompt=0
  else
    printf '\\e]7770;D;%d\\a' "$e"
  fi

  printf '\\e]7;file://%s%s\\a' "$(hostname)" "$PWD"
  printf '\\e]7770;A\\a'
  PS1="\${gray_dot}\${PS1}"
}

PROMPT_COMMAND="__td_prompt_command"
`;
}

function getOrCreateIntegrationDir(): string {
  if (integrationDir) return integrationDir;

  integrationDir = path.join(
    os.tmpdir(),
    `terminal-division-shell-${process.pid}`,
  );
  fs.mkdirSync(integrationDir, { recursive: true });

  const origZdotdir = process.env.ZDOTDIR || os.homedir();

  fs.writeFileSync(
    path.join(integrationDir, ".zshenv"),
    createZshenv(origZdotdir),
    "utf8",
  );
  fs.writeFileSync(
    path.join(integrationDir, ".zshrc"),
    createZshrc(origZdotdir),
    "utf8",
  );
  fs.writeFileSync(
    path.join(integrationDir, ".bashrc"),
    createBashrc(),
    "utf8",
  );

  return integrationDir;
}

/**
 * PTY起動時に追加する環境変数を返す
 */
export function getShellIntegrationEnv(shell: string): Record<string, string> {
  const shellName = path.basename(shell);
  const dir = getOrCreateIntegrationDir();

  if (shellName === "zsh") {
    return {
      ZDOTDIR: dir,
      __TD_ORIG_ZDOTDIR: process.env.ZDOTDIR || os.homedir(),
      __TD_INTEGRATION_DIR: dir,
    };
  }

  return {};
}

/**
 * シェル起動時の引数を返す（bash用の --rcfile など）
 */
export function getShellArgs(shell: string): string[] {
  const shellName = path.basename(shell);
  const dir = getOrCreateIntegrationDir();

  if (shellName === "bash") {
    return ["--rcfile", path.join(dir, ".bashrc")];
  }

  // zsh: ログインシェルフラグなし（ZDOTDIRで統合を注入）
  return [];
}

// --- 多層フォールバックPATH解決 ---

// 解決済みPATHのキャッシュ
let resolvedPath: string | null = null;

/**
 * Finder起動時に未設定の可能性がある必須環境変数を保証する
 */
function ensureEssentialEnvVars(): void {
  if (!process.env.HOME) process.env.HOME = os.homedir();
  if (!process.env.USER) process.env.USER = os.userInfo().username;
  if (!process.env.SHELL) process.env.SHELL = "/bin/zsh";
  if (!process.env.LANG) process.env.LANG = "ja_JP.UTF-8";
}

/**
 * PATHが有効かどうかを検証する
 * /usr/binを含み、3つ以上のエントリがあり、長さが4096未満であること
 */
function validatePath(p: string): boolean {
  return p.includes("/usr/bin") && p.split(":").length >= 3 && p.length < 4096;
}

/**
 * Strategy 1: 非インタラクティブログインシェルからPATHを取得
 * -ilc → -lc に変更し、printf使用、stdin:ignore でブロック防止
 */
function resolvePathFromLoginShell(shell: string): string | null {
  // npm_*とZDOTDIRを除外したクリーン環境を作成
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("npm_") && key !== "ZDOTDIR",
    ),
  ) as { [key: string]: string };

  try {
    const result = spawnSync(
      shell,
      ["-lc", 'printf "__TD_PATH_MARKER%s__TD_PATH_MARKER" "$PATH"'],
      {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...cleanEnv,
          TERM: "dumb",
        },
      },
    );

    if (result.error) {
      console.warn("Strategy 1 (login shell) error:", result.error.message);
      return null;
    }

    if (result.status !== 0) {
      console.warn(
        `Strategy 1 (login shell) failed: exitCode=${result.status}, signal=${result.signal}, stderr=${(result.stderr || "").slice(0, 200)}`,
      );
      return null;
    }

    const output = result.stdout || "";
    const match = output.match(/__TD_PATH_MARKER(.+?)__TD_PATH_MARKER/);
    if (match && validatePath(match[1])) {
      return match[1];
    }

    console.warn(
      "Strategy 1 (login shell): PATH extraction or validation failed",
    );
    return null;
  } catch (error) {
    console.warn("Strategy 1 (login shell) exception:", error);
    return null;
  }
}

/**
 * Strategy 2: macOS path_helper からシステムPATHを取得
 * /etc/paths + /etc/paths.d/* のパスを返す。シェルに依存しない。
 */
function resolvePathFromPathHelper(): string | null {
  try {
    const result = spawnSync("/usr/libexec/path_helper", ["-s"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.error || result.status !== 0) {
      console.warn(
        "Strategy 2 (path_helper) failed:",
        result.error?.message || `exitCode=${result.status}`,
      );
      return null;
    }

    // 出力形式: PATH="..."; export PATH;
    const output = result.stdout || "";
    const match = output.match(/PATH="([^"]+)"/);
    if (match) {
      return match[1];
    }

    console.warn("Strategy 2 (path_helper): failed to parse output");
    return null;
  } catch (error) {
    console.warn("Strategy 2 (path_helper) exception:", error);
    return null;
  }
}

/**
 * Strategy 3: Well-known paths をファイルシステムで直接プローブ
 * シェル起動不要。既知のツールチェインパスの存在を確認する。
 */
function resolvePathFromWellKnownPaths(): string[] {
  const home = process.env.HOME || os.homedir();
  const found: string[] = [];

  // 固定パス候補
  const candidates = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    path.join(home, ".volta/bin"),
    path.join(home, ".asdf/shims"),
    path.join(home, ".cargo/bin"),
    path.join(home, ".local/bin"),
    path.join(home, "go/bin"),
    path.join(home, ".deno/bin"),
    path.join(home, ".bun/bin"),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        found.push(p);
      }
    } catch {
      // アクセス不可は無視
    }
  }

  // nvm: ~/.nvm/versions/node/*/bin から最新バージョンを自動検出
  const nvmVersionsDir = path.join(home, ".nvm/versions/node");
  try {
    if (fs.existsSync(nvmVersionsDir)) {
      const versions = fs
        .readdirSync(nvmVersionsDir)
        .filter((v) => v.startsWith("v"))
        .sort((a, b) => {
          // セマンティックバージョン比較（降順 = 最新が先頭）
          const pa = a.slice(1).split(".").map(Number);
          const pb = b.slice(1).split(".").map(Number);
          for (let i = 0; i < 3; i++) {
            if ((pa[i] || 0) !== (pb[i] || 0))
              return (pb[i] || 0) - (pa[i] || 0);
          }
          return 0;
        });

      if (versions.length > 0) {
        const latestBin = path.join(nvmVersionsDir, versions[0], "bin");
        if (fs.existsSync(latestBin)) {
          found.push(latestBin);
        }
      }
    }
  } catch {
    // nvm検出失敗は無視
  }

  return found;
}

/**
 * アプリ起動時に多層フォールバックでPATHを解決する
 *
 * 1. 必須環境変数を保証
 * 2. Strategy 1: 非インタラクティブログインシェル → 成功&検証OK → return
 * 3. Strategy 2: macOS path_helper でシステムPATHを取得
 * 4. Strategy 3: Well-known paths をファイルシステムでプローブ
 * 5. 2+3をマージして resolvedPath に設定
 * 6. 全失敗時: process.env.PATHをフォールバック
 */
export function resolveLoginShellPath(): void {
  ensureEssentialEnvVars();

  const shell = process.env.SHELL || "/bin/zsh";

  // Strategy 1: ログインシェルから取得（最も正確）
  const loginShellPath = resolvePathFromLoginShell(shell);
  if (loginShellPath) {
    resolvedPath = loginShellPath;
    console.log("Resolved PATH via Strategy 1 (login shell)");
    console.log("Final resolved PATH:", resolvedPath);
    return;
  }

  // Strategy 1失敗 → Strategy 2 + 3 をマージ
  console.log("Strategy 1 failed, falling back to Strategy 2 + 3");

  const pathHelperPath = resolvePathFromPathHelper();
  const wellKnownPaths = resolvePathFromWellKnownPaths();

  // path_helperのPATHをベースに、well-known pathsを追加
  const basePath =
    pathHelperPath || process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin";
  const baseDirs = basePath.split(":");
  const baseSet = new Set(baseDirs);

  // well-known pathsから、まだ含まれていないものだけ追加
  const extraDirs = wellKnownPaths.filter((p) => !baseSet.has(p));
  const merged = [...extraDirs, ...baseDirs].join(":");

  if (merged && merged !== process.env.PATH) {
    resolvedPath = merged;
    console.log(
      `Resolved PATH via fallback (path_helper: ${pathHelperPath ? "yes" : "no"}, well-known: ${wellKnownPaths.length} paths)`,
    );
  } else {
    console.warn(
      "All PATH resolution strategies failed. Using process.env.PATH as fallback.",
    );
  }

  console.log("Final resolved PATH:", resolvedPath || process.env.PATH);
}

/**
 * 解決済みPATHとprocess.env.PATHをマージして返す
 * 解決済みPATHの順序を優先し、process.env.PATHの追加エントリを末尾に付与
 */
export function getMergedPath(): string {
  const currentPath = process.env.PATH || "";
  if (!resolvedPath) return currentPath;

  const resolvedDirs = resolvedPath.split(":");
  const currentDirs = currentPath.split(":");

  // 解決済みPATHに含まれないエントリだけ末尾に追加
  const resolvedSet = new Set(resolvedDirs);
  const extraDirs = currentDirs.filter((dir) => !resolvedSet.has(dir));

  return [...resolvedDirs, ...extraDirs].join(":");
}

/**
 * 一時ディレクトリのクリーンアップ
 */
export function cleanup(): void {
  if (!integrationDir) return;

  try {
    fs.rmSync(integrationDir, { recursive: true, force: true });
  } catch {
    // クリーンアップ失敗は無視
  }
  integrationDir = null;
}
