export interface PaneCwdInput {
  paneId: string;
  cwd: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface CwdTab {
  cwd: string;
  label: string; // basename もしくは "name (parent)"
  fullPath: string; // tooltip 用
  paneIds: string[]; // 集約された全ペイン (pinned-only タブでは空)
  // タブの順序ソート用：このタブの初出ペインの createdAt。
  // pinned-only タブ (ペインが無い) は Number.MAX_SAFE_INTEGER とし、ペイン由来タブの後ろに並ぶ
  firstCreatedAt: number;
  // 直近アクティブだった所属ペイン。pinned-only タブでは null
  lastActivePaneId: string | null;
  // ユーザがこの CWD を「ピン留め」しているか。ペイン消滅後も残るタブとして扱う
  pinned: boolean;
}

/**
 * 末尾のスラッシュを正規化（ルート以外）
 */
function normalizeCwd(cwd: string): string {
  if (cwd.length > 1 && (cwd.endsWith("/") || cwd.endsWith("\\"))) {
    return cwd.slice(0, -1);
  }
  return cwd;
}

/**
 * パスから basename を取り出す（POSIX/Win 両対応の最小実装）
 */
export function basenameOf(p: string): string {
  const norm = normalizeCwd(p);
  const idx = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  if (idx < 0) return norm;
  return norm.slice(idx + 1) || norm;
}

/**
 * パスから親ディレクトリの basename を取り出す
 */
export function parentBasenameOf(p: string): string {
  const norm = normalizeCwd(p);
  const idx = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  if (idx <= 0) return ""; // ルート直下 or basename のみ
  return basenameOf(norm.slice(0, idx));
}

/**
 * ペイン群と「ピン留めされた追加 CWD」を集約してタブ配列を構築する。
 * - 同じ CWD のペインは 1 タブに集約
 * - `pinnedCwds` に含まれる CWD は `pinned: true` でマークし、ペインが無くてもタブとして残す
 * - ペイン CWD と pinned CWD が同一なら 1 タブに合流（pinned: true）
 * - basename が他タブと衝突する全タブを `name (parent)` 形式に書き換え
 * - 並び順: ペイン由来タブ (createdAt 昇順) → pinned-only タブ (pinnedCwds の順)
 */
export function buildCwdTabs(
  panes: PaneCwdInput[],
  pinnedCwds: readonly string[] = [],
): CwdTab[] {
  // CWD でグループ化（ペイン側）
  const groups = new Map<string, PaneCwdInput[]>();
  for (const pane of panes) {
    const key = normalizeCwd(pane.cwd);
    const arr = groups.get(key);
    if (arr) {
      arr.push(pane);
    } else {
      groups.set(key, [pane]);
    }
  }

  const pinnedSet = new Set<string>();
  for (const p of pinnedCwds) pinnedSet.add(normalizeCwd(p));

  const tabs: CwdTab[] = [];

  // 1. ペイン由来タブ
  for (const [cwd, members] of groups.entries()) {
    let firstCreatedAt = Infinity;
    let lastActivePaneId: string | null = members[0].paneId;
    let lastActiveAt = -Infinity;
    const paneIds: string[] = [];
    for (const m of members) {
      paneIds.push(m.paneId);
      if (m.createdAt < firstCreatedAt) firstCreatedAt = m.createdAt;
      if (m.lastActiveAt > lastActiveAt) {
        lastActiveAt = m.lastActiveAt;
        lastActivePaneId = m.paneId;
      }
    }
    tabs.push({
      cwd,
      label: basenameOf(cwd),
      fullPath: cwd,
      paneIds,
      firstCreatedAt,
      lastActivePaneId,
      pinned: pinnedSet.has(cwd),
    });
  }

  // 2. pinned-only タブ（ペインで覆われていない pinned CWD）
  // 並び順は pinnedCwds の順序を保つ。pinned-only は createdAt を MAX とし末尾に
  let pinnedOrder = 0;
  for (const raw of pinnedCwds) {
    const cwd = normalizeCwd(raw);
    if (groups.has(cwd)) continue; // ペインで覆われている
    if (tabs.some((t) => t.cwd === cwd)) continue; // 既に追加済み (重複入力)
    tabs.push({
      cwd,
      label: basenameOf(cwd),
      fullPath: cwd,
      paneIds: [],
      // ペイン由来タブ (createdAt が有限値) より大きく、かつ pinnedCwds 順を保つ値
      firstCreatedAt: Number.MAX_SAFE_INTEGER - pinnedCwds.length + pinnedOrder,
      lastActivePaneId: null,
      pinned: true,
    });
    pinnedOrder++;
  }

  if (tabs.length === 0) return [];

  // basename 衝突検出 → "name (parent)"
  const labelCount = new Map<string, number>();
  for (const tab of tabs) {
    labelCount.set(tab.label, (labelCount.get(tab.label) ?? 0) + 1);
  }
  for (const tab of tabs) {
    if ((labelCount.get(tab.label) ?? 0) > 1) {
      const parent = parentBasenameOf(tab.cwd);
      tab.label = parent
        ? `${basenameOf(tab.cwd)} (${parent})`
        : basenameOf(tab.cwd);
    }
  }

  tabs.sort((a, b) => a.firstCreatedAt - b.firstCreatedAt);
  return tabs;
}

/**
 * ホームディレクトリ起点の相対パス（先頭に ~/ を付ける）
 * 範囲外なら絶対パスをそのまま返す
 */
export function homeRelativePath(absPath: string, homeDir: string): string {
  if (!homeDir) return absPath;
  const normHome = normalizeCwd(homeDir);
  if (absPath === normHome) return "~";
  if (
    absPath.startsWith(normHome + "/") ||
    absPath.startsWith(normHome + "\\")
  ) {
    return "~" + absPath.slice(normHome.length);
  }
  return absPath;
}

/**
 * baseCwd 起点での相対パスを POSIX 形式（'/' 区切り）で返す。
 * 同じディレクトリは ".", 子孫は "foo/bar", 範囲外は必要に応じて "../" を付ける。
 * baseCwd が空、またはルートが一致しない場合は絶対パスをそのまま返す。
 */
export function terminalRelativePath(absPath: string, baseCwd: string): string {
  if (!baseCwd) return absPath;
  const normPath = normalizeCwd(absPath).replace(/\\/g, "/");
  const normBase = normalizeCwd(baseCwd).replace(/\\/g, "/");
  if (normPath === normBase) return ".";

  const pathParts = normPath.split("/");
  const baseParts = normBase.split("/");

  let commonLen = 0;
  const minLen = Math.min(pathParts.length, baseParts.length);
  while (commonLen < minLen && pathParts[commonLen] === baseParts[commonLen]) {
    commonLen++;
  }

  // ルート（先頭が "" の絶対パス）が一致しないなら相対化不能とみなす
  if (commonLen === 0) return absPath;

  const upCount = baseParts.length - commonLen;
  const downParts = pathParts.slice(commonLen);

  const segments: string[] = [];
  for (let i = 0; i < upCount; i++) segments.push("..");
  segments.push(...downParts);

  return segments.length > 0 ? segments.join("/") : ".";
}
