import { create } from "zustand";

export type FileOp =
  | { kind: "rename"; from: string; to: string }
  | { kind: "move"; from: string; to: string }
  | {
      kind: "trash";
      originalPath: string;
      trashedAt: string | null; // null だと undo 不可
    };

const MAX_HISTORY = 50;

interface FileOpsHistoryStore {
  undoStack: FileOp[];
  redoStack: FileOp[];
  pushOp: (op: FileOp) => void;
  popUndo: () => FileOp | undefined;
  popRedo: () => FileOp | undefined;
  pushRedo: (op: FileOp) => void;
  pushUndo: (op: FileOp) => void;
  clear: () => void;
}

export const useFileOpsHistoryStore = create<FileOpsHistoryStore>(
  (set, get) => ({
    undoStack: [],
    redoStack: [],

    pushOp: (op) => {
      const { undoStack } = get();
      const next = [...undoStack, op];
      if (next.length > MAX_HISTORY) next.shift();
      // 新規操作で redo はクリア
      set({ undoStack: next, redoStack: [] });
    },

    popUndo: () => {
      const { undoStack } = get();
      if (undoStack.length === 0) return undefined;
      const next = undoStack.slice(0, -1);
      const top = undoStack[undoStack.length - 1];
      set({ undoStack: next });
      return top;
    },

    popRedo: () => {
      const { redoStack } = get();
      if (redoStack.length === 0) return undefined;
      const next = redoStack.slice(0, -1);
      const top = redoStack[redoStack.length - 1];
      set({ redoStack: next });
      return top;
    },

    pushRedo: (op) => {
      const next = [...get().redoStack, op];
      if (next.length > MAX_HISTORY) next.shift();
      set({ redoStack: next });
    },

    pushUndo: (op) => {
      const next = [...get().undoStack, op];
      if (next.length > MAX_HISTORY) next.shift();
      set({ undoStack: next });
    },

    clear: () => set({ undoStack: [], redoStack: [] }),
  }),
);

export function describeOp(op: FileOp): string {
  const baseFrom = op.kind === "trash" ? op.originalPath : op.from;
  const name = baseFrom.split("/").pop() ?? baseFrom;
  switch (op.kind) {
    case "rename":
      return `名称変更: ${name}`;
    case "move":
      return `移動: ${name}`;
    case "trash":
      return `削除: ${name}`;
  }
}
