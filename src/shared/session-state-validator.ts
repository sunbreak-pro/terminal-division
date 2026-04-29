// セッション永続化の DTO 型 + 検証ロジックの SSOT。
// Main / Preload / Renderer のすべてが本ファイルを参照する。
// Node API / Electron 依存は持たないため、どのプロセスからも import 可能。

export type SerializedDirection = "horizontal" | "vertical";

export interface SerializedTerminalPane {
  id: string;
  parentId: string | null;
}

export interface SerializedSplitNode {
  id: string;
  type: "split";
  direction: SerializedDirection;
  children: string[];
  parentId: string | null;
}

export type SerializedNode = SerializedTerminalPane | SerializedSplitNode;

export interface SerializedMeta {
  cwd: string | null;
  // 開かれていた MD タブの絶対パス配列（順序を保持）。最大 8 件。
  // 復元時は各タブが MarkdownEditor の mount で個別に IPC でファイル内容を読み込む。
  // dirty 状態は永続化対象外。空配列 / 未指定どちらも許容する。
  mdTabFilePaths?: string[];
}

// 1 ペインで開ける MD タブの最大数（terminalMetaStore.MD_TABS_MAX と一致）。
export const SESSION_STATE_MAX_MD_TABS = 8;

export interface SerializedLayout {
  version: 1;
  rootId: string;
  // Map<id, SerializedNode> をシリアライズした entries 配列
  nodes: Array<[string, SerializedNode]>;
  // Map<id, SerializedMeta> をシリアライズした entries 配列
  metas: Array<[string, SerializedMeta]>;
}

export const SESSION_STATE_VERSION = 1 as const;
export const SESSION_STATE_MAX_NODES = 11; // 6 葉 + 5 分岐 = 最大 11 ノード
export const SESSION_STATE_MAX_LEAVES = 6;

// 検証: 1 つでも違反したら全体破棄。型を絞り込んで返す。
// renderer / main いずれの側でも共通の整合性を要求する。
export function validateSerializedLayout(
  raw: unknown,
): SerializedLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (obj.version !== SESSION_STATE_VERSION) return null;
  if (typeof obj.rootId !== "string" || obj.rootId.length === 0) return null;
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.metas)) return null;

  // ノード配列の検証
  if (obj.nodes.length === 0 || obj.nodes.length > SESSION_STATE_MAX_NODES) {
    return null;
  }

  const nodeMap = new Map<string, SerializedNode>();
  for (const entry of obj.nodes) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [id, node] = entry;
    if (typeof id !== "string" || id.length === 0) return null;
    if (!node || typeof node !== "object") return null;
    const n = node as Record<string, unknown>;
    if (n.id !== id) return null;
    if (!(n.parentId === null || typeof n.parentId === "string")) return null;

    if (n.type === "split") {
      if (n.direction !== "horizontal" && n.direction !== "vertical")
        return null;
      if (!Array.isArray(n.children) || n.children.length !== 2) return null;
      if (n.children.some((c) => typeof c !== "string")) return null;
      nodeMap.set(id, {
        id,
        type: "split",
        direction: n.direction,
        children: n.children as string[],
        parentId: n.parentId as string | null,
      });
    } else if (!("type" in n) || n.type === undefined) {
      // TerminalPane (葉) — type プロパティを持たない
      nodeMap.set(id, {
        id,
        parentId: n.parentId as string | null,
      });
    } else {
      return null;
    }
  }

  // rootId が存在
  const root = nodeMap.get(obj.rootId);
  if (!root) return null;
  if (root.parentId !== null) return null;

  // 親子関係の整合 + サイクル検出（BFS で root から到達可能かを判定）
  const visited = new Set<string>();
  const queue: string[] = [obj.rootId];
  let leafCount = 0;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) return null; // 同一ノードに 2 回到達 = サイクル / 重複参照
    visited.add(cur);
    const n = nodeMap.get(cur);
    if (!n) return null;
    if ("type" in n && n.type === "split") {
      for (const childId of n.children) {
        const child = nodeMap.get(childId);
        if (!child) return null;
        if (child.parentId !== cur) return null;
        queue.push(childId);
      }
    } else {
      leafCount++;
    }
  }
  // 全ノードが root から到達できているか（孤立ノードを排除）
  if (visited.size !== nodeMap.size) return null;
  if (leafCount === 0 || leafCount > SESSION_STATE_MAX_LEAVES) return null;

  // metas の検証（葉 ID に対応する cwd のみ受け入れ）
  const metaMap = new Map<string, SerializedMeta>();
  for (const entry of obj.metas) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [id, meta] = entry;
    if (typeof id !== "string") return null;
    if (!meta || typeof meta !== "object") return null;
    const m = meta as Record<string, unknown>;
    if (!(m.cwd === null || typeof m.cwd === "string")) return null;
    // mdTabFilePaths（任意）の検証: 文字列配列 / 最大 8 件 / 各要素は非空
    let mdTabFilePaths: string[] | undefined = undefined;
    if (m.mdTabFilePaths !== undefined) {
      if (!Array.isArray(m.mdTabFilePaths)) return null;
      if (m.mdTabFilePaths.length > SESSION_STATE_MAX_MD_TABS) return null;
      const filtered: string[] = [];
      for (const fp of m.mdTabFilePaths) {
        if (typeof fp !== "string" || fp.length === 0) return null;
        filtered.push(fp);
      }
      mdTabFilePaths = filtered;
    }
    // 未知の id は無視（葉のみ採用）
    const node = nodeMap.get(id);
    if (!node || ("type" in node && node.type === "split")) continue;
    metaMap.set(id, {
      cwd: m.cwd,
      ...(mdTabFilePaths ? { mdTabFilePaths } : {}),
    });
  }

  return {
    version: SESSION_STATE_VERSION,
    rootId: obj.rootId,
    nodes: Array.from(nodeMap.entries()),
    metas: Array.from(metaMap.entries()),
  };
}
