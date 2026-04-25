import { app } from "electron";
import { join } from "path";
import fs from "fs";
import {
  SESSION_STATE_VERSION,
  SESSION_STATE_MAX_NODES,
  type SerializedLayout,
  type SerializedNode,
  type SerializedMeta,
} from "./types/session-state";

const SAVE_DEBOUNCE_MS = 250;
const MAX_LEAVES = 6;

class SessionStateManager {
  private filePath: string;
  private state: SerializedLayout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.filePath = join(app.getPath("userData"), "session-state.json");
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.state = null;
        return;
      }
      const raw: unknown = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      const validated = validateSerializedLayout(raw);
      this.state = validated;
    } catch {
      // 破損 / 検証失敗 → サイレントフォールバック
      this.state = null;
    }
  }

  private writeNow(): void {
    try {
      if (this.state === null) {
        if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
        return;
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.warn("[SessionState] save error:", e);
    }
  }

  // 起動時に 1 度だけ呼ばれ、復元データを返す。検証失敗時は null。
  getRestoreData(): SerializedLayout | null {
    return this.state;
  }

  save(layout: SerializedLayout): void {
    const validated = validateSerializedLayout(layout);
    if (!validated) {
      // Main 側でも防衛的に検証。失敗したら無視（古い状態を維持）。
      console.warn("[SessionState] save rejected: validation failed");
      return;
    }
    this.state = validated;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.writeNow(), SAVE_DEBOUNCE_MS);
  }

  clear(): void {
    this.state = null;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.writeNow(), SAVE_DEBOUNCE_MS);
  }

  // テスト用: pending な debounce を即時実行
  flushForTest(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.writeNow();
    }
  }
}

// 検証: 1 つでも違反したら全体破棄。型を絞り込んで返す。
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
  if (leafCount === 0 || leafCount > MAX_LEAVES) return null;

  // metas の検証（葉 ID に対応する cwd のみ受け入れ）
  const metaMap = new Map<string, SerializedMeta>();
  for (const entry of obj.metas) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [id, meta] = entry;
    if (typeof id !== "string") return null;
    if (!meta || typeof meta !== "object") return null;
    const m = meta as Record<string, unknown>;
    if (!(m.cwd === null || typeof m.cwd === "string")) return null;
    // 未知の id は無視（葉のみ採用）
    const node = nodeMap.get(id);
    if (!node || ("type" in node && node.type === "split")) continue;
    metaMap.set(id, { cwd: m.cwd });
  }

  return {
    version: SESSION_STATE_VERSION,
    rootId: obj.rootId,
    nodes: Array.from(nodeMap.entries()),
    metas: Array.from(metaMap.entries()),
  };
}

export const sessionStateManager = new SessionStateManager();
