// セッション永続化の IPC / ファイル間で受け渡しする DTO（Main / Renderer 共通形式）
// renderer 側の types/layout.ts と完全に独立し、シリアライズ可能なフィールドのみを持つ。

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
}

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
