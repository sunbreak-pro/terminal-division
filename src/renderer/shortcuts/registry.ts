// ショートカット定義の SSOT。
// App.tsx の keydown ハンドラと ShortcutsModal / SettingsModal の表示は
// ここから生成される。settings.shortcuts でユーザーがキーを上書き可能。

export type ShortcutId =
  // Terminal Management
  | "split-vertical"
  | "split-horizontal"
  | "close-pane"
  | "insert-file-path"
  | "find-in-pane"
  // Sidebar
  | "toggle-sidebar"
  | "reload-tree"
  | "undo"
  | "redo"
  // Navigation
  | "focus-up"
  | "focus-down"
  | "focus-left"
  | "focus-right"
  // Line Editing
  | "kill-line-backward"
  | "kill-line-forward"
  | "move-line-start"
  | "move-line-end"
  | "select-current-line"
  | "insert-newline"
  // Word Editing
  | "kill-word-backward"
  | "kill-word-forward"
  | "move-word-left"
  | "move-word-right"
  // Font
  | "font-zoom-in"
  | "font-zoom-out"
  | "font-zoom-reset"
  // App
  | "open-settings";

export type ShortcutCategory =
  | "Terminal Management"
  | "Sidebar"
  | "Navigation"
  | "Line Editing"
  | "Word Editing"
  | "Font"
  | "App";

export interface ShortcutDefinition {
  id: ShortcutId;
  category: ShortcutCategory;
  label: string;
  // 正規化済みキー文字列（例: "Cmd+D", "Cmd+Shift+ArrowLeft"）。
  // null は現状ありえない（デフォルトは必ず割当あり）が、settings 側で null になりうる。
  defaultKey: string;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  // Terminal Management
  {
    id: "split-vertical",
    category: "Terminal Management",
    label: "縦に分割",
    defaultKey: "Cmd+D",
  },
  {
    id: "split-horizontal",
    category: "Terminal Management",
    label: "横に分割",
    defaultKey: "Cmd+Shift+D",
  },
  {
    id: "close-pane",
    category: "Terminal Management",
    label: "現在のターミナルを閉じる",
    defaultKey: "Cmd+W",
  },
  {
    id: "insert-file-path",
    category: "Terminal Management",
    label: "ファイルを選択してパスを挿入",
    defaultKey: "Cmd+O",
  },
  {
    id: "find-in-pane",
    category: "Terminal Management",
    label: "ペイン内検索 / パス履歴",
    defaultKey: "Cmd+F",
  },
  // Sidebar
  {
    id: "toggle-sidebar",
    category: "Sidebar",
    label: "サイドバーの開閉",
    defaultKey: "Cmd+.",
  },
  {
    id: "reload-tree",
    category: "Sidebar",
    label: "ディレクトリツリーを再読み込み",
    defaultKey: "Cmd+R",
  },
  {
    id: "undo",
    category: "Sidebar",
    label: "Undo（サイドバー or ターミナル行入力）",
    defaultKey: "Cmd+Z",
  },
  {
    id: "redo",
    category: "Sidebar",
    label: "Redo（サイドバー or ターミナル行入力）",
    defaultKey: "Cmd+Shift+Z",
  },
  // Navigation
  {
    id: "focus-up",
    category: "Navigation",
    label: "上のターミナルに移動",
    defaultKey: "Cmd+Option+ArrowUp",
  },
  {
    id: "focus-down",
    category: "Navigation",
    label: "下のターミナルに移動",
    defaultKey: "Cmd+Option+ArrowDown",
  },
  {
    id: "focus-left",
    category: "Navigation",
    label: "左のターミナルに移動",
    defaultKey: "Cmd+Option+ArrowLeft",
  },
  {
    id: "focus-right",
    category: "Navigation",
    label: "右のターミナルに移動",
    defaultKey: "Cmd+Option+ArrowRight",
  },
  // Line Editing
  {
    id: "kill-line-backward",
    category: "Line Editing",
    label: "カーソル位置から行頭まで削除",
    defaultKey: "Cmd+Backspace",
  },
  {
    id: "kill-line-forward",
    category: "Line Editing",
    label: "カーソル位置から行末まで削除",
    defaultKey: "Cmd+K",
  },
  {
    id: "move-line-start",
    category: "Line Editing",
    label: "行頭に移動",
    defaultKey: "Cmd+ArrowLeft",
  },
  {
    id: "move-line-end",
    category: "Line Editing",
    label: "行末に移動",
    defaultKey: "Cmd+ArrowRight",
  },
  {
    id: "select-current-line",
    category: "Line Editing",
    label: "現在のプロンプト行を選択",
    defaultKey: "Cmd+Shift+A",
  },
  {
    id: "insert-newline",
    category: "Line Editing",
    label: "改行を挿入（コマンド実行なし）",
    defaultKey: "Shift+Enter",
  },
  // Word Editing
  {
    id: "kill-word-backward",
    category: "Word Editing",
    label: "前の単語を削除",
    defaultKey: "Option+Backspace",
  },
  {
    id: "kill-word-forward",
    category: "Word Editing",
    label: "次の単語を削除",
    defaultKey: "Option+D",
  },
  {
    id: "move-word-left",
    category: "Word Editing",
    label: "前の単語に移動",
    defaultKey: "Option+ArrowLeft",
  },
  {
    id: "move-word-right",
    category: "Word Editing",
    label: "次の単語に移動",
    defaultKey: "Option+ArrowRight",
  },
  // Font
  {
    id: "font-zoom-in",
    category: "Font",
    label: "フォントを拡大（アクティブペイン）",
    defaultKey: "Cmd+=",
  },
  {
    id: "font-zoom-out",
    category: "Font",
    label: "フォントを縮小（アクティブペイン）",
    defaultKey: "Cmd+-",
  },
  {
    id: "font-zoom-reset",
    category: "Font",
    label: "フォントサイズをリセット（アクティブペイン）",
    defaultKey: "Cmd+0",
  },
  // App
  {
    id: "open-settings",
    category: "App",
    label: "設定を開く",
    defaultKey: "Cmd+,",
  },
];

const DEFINITION_BY_ID = new Map<ShortcutId, ShortcutDefinition>(
  SHORTCUT_DEFINITIONS.map((d) => [d.id, d]),
);

export function getDefinition(id: ShortcutId): ShortcutDefinition | undefined {
  return DEFINITION_BY_ID.get(id);
}

// ========== Key normalization ==========

// 単一キー名を正規化する。letter は uppercase に揃える。
// それ以外（ArrowLeft, Backspace, Enter, ., , 等）はそのまま。
function normalizeKeyName(rawKey: string): string {
  // " " は length 1 だが Space と表記する（記号として残すと "Cmd+ " になり読みにくい）
  if (rawKey === " ") return "Space";
  if (rawKey.length === 1) {
    // letter: 大文字に。記号 (".", ",", "/", ";") はそのまま
    if (/^[a-zA-Z]$/.test(rawKey)) return rawKey.toUpperCase();
    return rawKey;
  }
  return rawKey;
}

// KeyboardEvent から正規化済みキー文字列を作る。
// 形式: "Cmd+Ctrl+Option+Shift+<KeyName>"（修飾キーのみのときはキー名なし）。
// 修飾キー単体押下（例: Shift だけ）は null を返す。
export function parseKey(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}): string | null {
  // 修飾キー単体は録音対象にしない
  if (
    event.key === "Meta" ||
    event.key === "Control" ||
    event.key === "Alt" ||
    event.key === "Shift" ||
    event.key === "Dead"
  ) {
    return null;
  }
  const parts: string[] = [];
  if (event.metaKey) parts.push("Cmd");
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Option");
  if (event.shiftKey) parts.push("Shift");
  parts.push(normalizeKeyName(event.key));
  return parts.join("+");
}

// 既知の正規化キー文字列同士の比較。大文字小文字を揃えてから比較する。
// 念のため "cmd+d" のような外部由来文字列も受け入れる。
export function matchKey(
  event: {
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    key: string;
  },
  expected: string | null | undefined,
): boolean {
  if (!expected) return false;
  const eventKey = parseKey(event);
  if (!eventKey) return false;
  return canonicalize(eventKey) === canonicalize(expected);
}

function canonicalize(key: string): string {
  // "cmd+shift+d" / "Cmd+Shift+D" / "CMD+SHIFT+D" を統一
  const parts = key
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "";
  const modifierOrder = ["Cmd", "Ctrl", "Option", "Shift"];
  const modifierAlias: Record<string, string> = {
    cmd: "Cmd",
    meta: "Cmd",
    command: "Cmd",
    ctrl: "Ctrl",
    control: "Ctrl",
    option: "Option",
    alt: "Option",
    shift: "Shift",
  };
  const mods = new Set<string>();
  let keyName = "";
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (modifierAlias[lower]) {
      mods.add(modifierAlias[lower]);
    } else {
      keyName = normalizeKeyName(p);
    }
  }
  const orderedMods = modifierOrder.filter((m) => mods.has(m));
  return [...orderedMods, keyName].filter((p) => p.length > 0).join("+");
}

// 正規化済みキー文字列を表示用記号に変換。例: "Cmd+Shift+D" → "⌘ ⇧ D"
const DISPLAY_MAP: Record<string, string> = {
  Cmd: "⌘",
  Ctrl: "⌃",
  Option: "⌥",
  Shift: "⇧",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Backspace: "⌫",
  Enter: "⏎",
  Space: "␣",
  Escape: "⎋",
  Tab: "⇥",
};

export function formatKey(key: string | null | undefined): string {
  if (!key) return "（未設定）";
  const canonical = canonicalize(key);
  if (canonical.length === 0) return "（未設定）";
  return canonical
    .split("+")
    .map((p) => DISPLAY_MAP[p] ?? p)
    .join(" ");
}

// 解決済みキー（settings の上書きを反映）を返す。
// settings.shortcuts に当該 ID があれば: null なら無効、文字列ならそれを使う。
// 当該 ID がなければ defaultKey を使う。
export function resolveShortcutKey(
  id: ShortcutId,
  bindings: Record<string, string | null>,
): string | null {
  if (Object.prototype.hasOwnProperty.call(bindings, id)) {
    return bindings[id];
  }
  return DEFINITION_BY_ID.get(id)?.defaultKey ?? null;
}

// 競合検出: bindings + defaults から「同じキーに割り当てられた ID 群」を返す。
// 特定のキーで衝突しているかを SettingsModal から問い合わせる用途。
export function findConflictingIds(
  key: string,
  bindings: Record<string, string | null>,
  excludeId?: ShortcutId,
): ShortcutId[] {
  const target = canonicalize(key);
  const matched: ShortcutId[] = [];
  for (const def of SHORTCUT_DEFINITIONS) {
    if (def.id === excludeId) continue;
    const resolved = resolveShortcutKey(def.id, bindings);
    if (resolved && canonicalize(resolved) === target) {
      matched.push(def.id);
    }
  }
  return matched;
}
