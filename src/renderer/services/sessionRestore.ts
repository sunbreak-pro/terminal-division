// セッション復元のシリアライズ／デシリアライズ層。
// Main 側で検証済みのデータを受け取る前提だが、renderer でも防衛的に最小限の整合チェックを行う。
// 型・検証関数の SSOT は src/shared/session-state-validator.ts。

import type { LayoutNode, SplitNode, TerminalPane } from "../types/layout";
import { useTerminalStore } from "../stores/terminalStore";
import { useTerminalMetaStore } from "../stores/terminalMetaStore";
import {
  SESSION_STATE_VERSION,
  validateSerializedLayout,
  type SerializedLayout,
  type SerializedNode,
  type SerializedSplitNode,
  type SerializedTerminalPane,
} from "../../shared/session-state-validator";

// 型はテストや外部から型 import できるように re-export
export type {
  SerializedLayout,
  SerializedNode,
  SerializedSplitNode,
  SerializedTerminalPane,
};

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

  // 葉ペインの cwd のみ保存対象。MD タブはアプリグローバルな markdownTabsStore に
  // 管理を移したためペインスコープのセッション保存対象から外す。
  const metaEntries: Array<[string, { cwd: string | null }]> = [];
  for (const [id, meta] of metas.entries()) {
    const node = nodes.get(id);
    if (!node) continue;
    if ("type" in node && node.type === "split") continue;
    metaEntries.push([id, { cwd: meta.cwd }]);
  }

  return {
    version: SESSION_STATE_VERSION,
    rootId,
    nodes: nodeEntries,
    metas: metaEntries,
  };
}

// SerializedLayout を Map<string, LayoutNode> に変換する。
// 防衛検証は shared/validateSerializedLayout に委譲し、ここは Map 化のみ行う。
export function deserializeLayout(
  payload: SerializedLayout,
): { nodes: Map<string, LayoutNode>; rootId: string } | null {
  const validated = validateSerializedLayout(payload);
  if (!validated) return null;

  const map = new Map<string, LayoutNode>();
  for (const [id, node] of validated.nodes) {
    if ("type" in node && node.type === "split") {
      const split: SplitNode = {
        id: node.id,
        type: "split",
        direction: node.direction,
        children: [...node.children],
        parentId: node.parentId,
      };
      map.set(id, split);
    } else {
      const pane: TerminalPane = {
        id: node.id,
        parentId: node.parentId,
      };
      map.set(id, pane);
    }
  }
  return { nodes: map, rootId: validated.rootId };
}

// 復元実行: ストアをハイドレートする。失敗時 false。
export function restoreSession(payload: SerializedLayout): boolean {
  const layout = deserializeLayout(payload);
  if (!layout) return false;

  const ok = useTerminalStore
    .getState()
    .hydrateLayout({ nodes: layout.nodes, rootId: layout.rootId });
  if (!ok) return false;

  // メタは葉ペインのみ採用（payload.metas に分岐 ID が混入していても無視される）。
  // 旧フォーマットに残っている mdTabFilePaths は完全に無視する。
  const leafEntries: Array<[string, { cwd: string | null }]> = payload.metas
    .filter(([id]) => {
      const node = layout.nodes.get(id);
      return node && !("type" in node && node.type === "split");
    })
    .map(([id, m]) => [id, { cwd: m.cwd }]);
  useTerminalMetaStore.getState().hydrateMetas(leafEntries);

  return true;
}
