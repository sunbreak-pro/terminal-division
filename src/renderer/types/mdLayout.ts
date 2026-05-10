// RightSidebar 内 Markdown エディタの二分木レイアウト型定義。
// terminalStore の SplitDirection / SplitNode と独立した型を持つ
// （葉ノード MdPane が tabIds[] / activeTabId を持つため共有できない）。

import type { SplitDirection } from "./layout";

export interface MdPane {
  id: string;
  parentId: string | null;
  // このペインに紐付く markdownTabsStore の tabId 配列（タブヘッダーに表示する）
  tabIds: string[];
  // tabIds の中で現在エディタに表示しているもの。空ペインなら null。
  activeTabId: string | null;
}

export interface MdSplitNode {
  id: string;
  type: "split";
  direction: SplitDirection;
  children: string[]; // 常に 2 要素
  parentId: string | null;
}

export type MdLayoutNode = MdPane | MdSplitNode;

export function isMdPane(node: MdLayoutNode): node is MdPane {
  return !("type" in node && node.type === "split");
}
