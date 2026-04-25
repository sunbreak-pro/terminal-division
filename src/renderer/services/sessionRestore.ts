// セッション復元のシリアライズ／デシリアライズ層。
// Main 側で検証済みのデータを受け取る前提だが、renderer でも防衛的に最小限の整合チェックを行う。

import type { LayoutNode, SplitNode, TerminalPane } from "../types/layout";
import { useTerminalStore } from "../stores/terminalStore";
import { useTerminalMetaStore } from "../stores/terminalMetaStore";

// preload と main で共有する DTO 形式。型のみ複製（cross-process 型共有は build 構成上避ける）。
export interface SerializedTerminalPane {
  id: string;
  parentId: string | null;
}
export interface SerializedSplitNode {
  id: string;
  type: "split";
  direction: "horizontal" | "vertical";
  children: string[];
  parentId: string | null;
}
export type SerializedNode = SerializedTerminalPane | SerializedSplitNode;
export interface SerializedLayout {
  version: 1;
  rootId: string;
  nodes: Array<[string, SerializedNode]>;
  metas: Array<[string, { cwd: string | null }]>;
}

const SERIALIZED_VERSION = 1 as const;

// 現在のストア状態をシリアライズ可能な形式に変換する。
export function serializeCurrentSession(): SerializedLayout {
  const { nodes, rootId } = useTerminalStore.getState();
  const { metas } = useTerminalMetaStore.getState();

  const nodeEntries: Array<[string, SerializedNode]> = [];
  for (const [id, node] of nodes.entries()) {
    if ("type" in node && node.type === "split") {
      nodeEntries.push([
        id,
        {
          id: node.id,
          type: "split",
          direction: node.direction,
          children: [...node.children],
          parentId: node.parentId,
        },
      ]);
    } else {
      nodeEntries.push([
        id,
        {
          id: node.id,
          parentId: node.parentId,
        },
      ]);
    }
  }

  // 葉ペインの cwd のみ保存対象
  const metaEntries: Array<[string, { cwd: string | null }]> = [];
  for (const [id, meta] of metas.entries()) {
    const node = nodes.get(id);
    if (!node) continue;
    if ("type" in node && node.type === "split") continue;
    metaEntries.push([id, { cwd: meta.cwd }]);
  }

  return {
    version: SERIALIZED_VERSION,
    rootId,
    nodes: nodeEntries,
    metas: metaEntries,
  };
}

// 検証済みの SerializedLayout を Map<string, LayoutNode> に変換する。
// renderer 側でも version / rootId / 最低限の構造をチェックして失敗時 null。
export function deserializeLayout(
  payload: SerializedLayout,
): { nodes: Map<string, LayoutNode>; rootId: string } | null {
  if (!payload || payload.version !== SERIALIZED_VERSION) return null;
  if (typeof payload.rootId !== "string" || payload.rootId.length === 0)
    return null;
  if (!Array.isArray(payload.nodes) || payload.nodes.length === 0) return null;

  const map = new Map<string, LayoutNode>();
  for (const entry of payload.nodes) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [id, node] = entry;
    if (typeof id !== "string") return null;
    if (!node || typeof node !== "object") return null;

    if ("type" in node && (node as SerializedSplitNode).type === "split") {
      const sn = node as SerializedSplitNode;
      if (sn.direction !== "horizontal" && sn.direction !== "vertical")
        return null;
      if (!Array.isArray(sn.children) || sn.children.length !== 2) return null;
      const split: SplitNode = {
        id: sn.id,
        type: "split",
        direction: sn.direction,
        children: [...sn.children],
        parentId: sn.parentId,
      };
      map.set(id, split);
    } else {
      const tp = node as SerializedTerminalPane;
      const pane: TerminalPane = {
        id: tp.id,
        parentId: tp.parentId,
      };
      map.set(id, pane);
    }
  }

  if (!map.has(payload.rootId)) return null;
  return { nodes: map, rootId: payload.rootId };
}

// 復元実行: ストアをハイドレートする。失敗時 false。
export function restoreSession(payload: SerializedLayout): boolean {
  const layout = deserializeLayout(payload);
  if (!layout) return false;

  const ok = useTerminalStore
    .getState()
    .hydrateLayout({ nodes: layout.nodes, rootId: layout.rootId });
  if (!ok) return false;

  // メタは葉ペインのみ採用（payload.metas に分岐 ID が混入していても無視される）
  const leafEntries = payload.metas.filter(([id]) => {
    const node = layout.nodes.get(id);
    return node && !("type" in node && node.type === "split");
  });
  useTerminalMetaStore.getState().hydrateMetas(leafEntries);

  return true;
}
