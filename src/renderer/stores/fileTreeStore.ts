import { create } from "zustand";

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
}

export type DirState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; entries: FileNode[] }
  | { status: "error"; message: string };

// 安定参照の idle センティネル
// useSyncExternalStore は getSnapshot を Object.is で比較するため、
// 毎回 `{ status: "idle" }` を新規生成すると「state が変わった」と誤検知して
// 無限ループに陥る。idle はモジュール定数として共有する。
const IDLE_STATE: DirState = Object.freeze({ status: "idle" }) as DirState;

interface FileTreeStore {
  // path → 子ノード状態
  dirs: Map<string, DirState>;
  // 監視中のパス → 参照カウント
  watchRefCounts: Map<string, number>;

  loadDir: (path: string) => Promise<void>;
  invalidateDir: (path: string) => void;
  getDirState: (path: string) => DirState;

  acquireWatch: (path: string) => void;
  releaseWatch: (path: string) => void;
}

export const useFileTreeStore = create<FileTreeStore>((set, get) => {
  const setDirState = (path: string, state: DirState): void => {
    const dirs = new Map(get().dirs);
    dirs.set(path, state);
    set({ dirs });
  };

  return {
    dirs: new Map(),
    watchRefCounts: new Map(),

    loadDir: async (path) => {
      setDirState(path, { status: "loading" });
      try {
        const result = await window.api.fs.readDir(path);
        if (result.ok) {
          setDirState(path, { status: "ready", entries: result.entries });
        } else {
          setDirState(path, { status: "error", message: result.error });
        }
      } catch (e) {
        setDirState(path, {
          status: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },

    invalidateDir: (path) => {
      const current = get().dirs.get(path);
      if (current && current.status === "ready") {
        // 既存エントリを保ったまま再ロードを発火する側に任せる
        void get().loadDir(path);
      }
    },

    getDirState: (path) => get().dirs.get(path) ?? IDLE_STATE,

    acquireWatch: (path) => {
      const refs = new Map(get().watchRefCounts);
      const next = (refs.get(path) ?? 0) + 1;
      refs.set(path, next);
      set({ watchRefCounts: refs });
      if (next === 1) {
        window.api.fs.watch(path);
      }
    },

    releaseWatch: (path) => {
      const refs = new Map(get().watchRefCounts);
      const cur = refs.get(path) ?? 0;
      const next = cur - 1;
      if (next <= 0) {
        refs.delete(path);
        window.api.fs.unwatch(path);
      } else {
        refs.set(path, next);
      }
      set({ watchRefCounts: refs });
    },
  };
});

export function useDirState(path: string | null): DirState {
  return useFileTreeStore((s) =>
    path ? (s.dirs.get(path) ?? IDLE_STATE) : IDLE_STATE,
  );
}
