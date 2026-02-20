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

// --- VSCode方式: ログインシェルからPATHを解決 ---

// 解決済みPATHのキャッシュ
let resolvedPath: string | null = null;

/**
 * アプリ起動時にログインシェルを一度だけ起動してPATHを取得する
 * TERM=dumb、npm関連/ZDOTDIR除外のクリーン環境で実行
 */
export function resolveLoginShellPath(): void {
  const shell = process.env.SHELL || "/bin/zsh";

  // npm_*とZDOTDIRを除外したクリーン環境を作成
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("npm_") && key !== "ZDOTDIR",
    ),
  ) as { [key: string]: string };

  try {
    const result = spawnSync(
      shell,
      ["-ilc", "echo __TD_PATH_MARKER$PATH__TD_PATH_MARKER"],
      {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...cleanEnv,
          TERM: "dumb",
        },
      },
    );

    const output = result.stdout || "";
    // マーカーでシェル起動時のノイズを除去してPATHだけ抽出
    const match = output.match(/__TD_PATH_MARKER(.+?)__TD_PATH_MARKER/);
    if (match) {
      resolvedPath = match[1];
      console.log("Resolved login shell PATH successfully");
    } else {
      console.warn("Failed to extract PATH from login shell output");
    }
  } catch (error) {
    console.warn("Failed to resolve login shell PATH:", error);
  }
}

/**
 * キャッシュ済みの解決済みPATHを返す
 */
export function getResolvedPath(): string | null {
  return resolvedPath;
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
