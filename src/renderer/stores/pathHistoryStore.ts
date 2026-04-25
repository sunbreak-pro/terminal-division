import { create } from "zustand";

export type PathKind = "absolute" | "relative";

export interface PathHistoryEntry {
  // 表示・コピー用の生文字列。絶対なら `/...` か `~/...`、相対なら `./...` 等そのまま
  raw: string;
  kind: PathKind;
  // 直近に観測した時刻（最新順ソートに使う）
  lastSeenAt: number;
  // 観測回数（同じパスが繰り返し現れた場合のヒント）
  count: number;
}

interface PathHistoryStore {
  // ペインごとの履歴。Map に保持し挿入順を維持しやすくする
  byPane: Map<string, PathHistoryEntry[]>;

  addPath: (paneId: string, raw: string, kind: PathKind) => void;
  getEntries: (paneId: string) => PathHistoryEntry[];
  clearPane: (paneId: string) => void;
  removePane: (paneId: string) => void;
}

const MAX_ENTRIES_PER_PANE = 200;

// 重複除去・ソート安定化のためのキー化（末尾スラッシュは正規化して同一視）
function normalizeKey(raw: string): string {
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw;
}

export const usePathHistoryStore = create<PathHistoryStore>((set, get) => ({
  byPane: new Map(),

  addPath: (paneId, raw, kind) => {
    if (raw.length === 0 || raw.length > 1024) return;
    const key = normalizeKey(raw);
    const byPane = new Map(get().byPane);
    const list = byPane.get(paneId)?.slice() ?? [];
    const existingIdx = list.findIndex((e) => normalizeKey(e.raw) === key);
    const now = Date.now();
    if (existingIdx >= 0) {
      const existing = list[existingIdx];
      list[existingIdx] = {
        ...existing,
        lastSeenAt: now,
        count: existing.count + 1,
      };
    } else {
      list.push({ raw, kind, lastSeenAt: now, count: 1 });
      if (list.length > MAX_ENTRIES_PER_PANE) {
        // 古い順に削る
        list.sort((a, b) => a.lastSeenAt - b.lastSeenAt);
        list.splice(0, list.length - MAX_ENTRIES_PER_PANE);
      }
    }
    byPane.set(paneId, list);
    set({ byPane });
  },

  getEntries: (paneId) => get().byPane.get(paneId) ?? [],

  clearPane: (paneId) => {
    const byPane = new Map(get().byPane);
    byPane.set(paneId, []);
    set({ byPane });
  },

  removePane: (paneId) => {
    if (!get().byPane.has(paneId)) return;
    const byPane = new Map(get().byPane);
    byPane.delete(paneId);
    set({ byPane });
  },
}));

// React 経由で履歴の生リストを購読する hook
// （ソート・フィルタは consumer 側で useMemo すること。
//  ここで毎回新規配列を返すと無限再レンダリングになる）
export function usePathHistory(paneId: string | null): PathHistoryEntry[] {
  return usePathHistoryStore((s) =>
    paneId ? (s.byPane.get(paneId) ?? EMPTY) : EMPTY,
  );
}

const EMPTY: PathHistoryEntry[] = Object.freeze([]) as PathHistoryEntry[];
