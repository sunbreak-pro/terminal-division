import type { LayoutNode, SplitNode, TerminalPane } from "../types/layout";

export function isTerminalPane(node: LayoutNode): node is TerminalPane {
  return !("type" in node && node.type === "split");
}

export function getAllTerminalIds(nodes: Map<string, LayoutNode>): string[] {
  const ids: string[] = [];
  for (const [id, node] of nodes) {
    if (isTerminalPane(node)) {
      ids.push(id);
    }
  }
  return ids;
}

// レイアウトツリーを DFS で走査し、葉ペインの出現順 ID 一覧を返す。
// SplitContainer のペイン番号付けと同じ順序を使う必要がある箇所で共有する。
export function collectPaneIdsInOrder(
  rootId: string,
  nodes: Map<string, LayoutNode>,
): string[] {
  const node = nodes.get(rootId);
  if (!node) return [];
  if ("type" in node && node.type === "split") {
    const splitNode = node as SplitNode;
    return splitNode.children.flatMap((childId) =>
      collectPaneIdsInOrder(childId, nodes),
    );
  }
  return [rootId];
}

// 指定された葉ペインの 1-based 表示番号を返す。見つからない場合は null。
export function getPaneNumber(
  rootId: string,
  nodes: Map<string, LayoutNode>,
  paneId: string,
): number | null {
  const ids = collectPaneIdsInOrder(rootId, nodes);
  const idx = ids.indexOf(paneId);
  return idx < 0 ? null : idx + 1;
}
