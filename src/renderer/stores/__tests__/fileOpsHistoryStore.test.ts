import { describe, it, expect, beforeEach } from "vitest";
import {
  useFileOpsHistoryStore,
  describeOp,
  type FileOp,
} from "../fileOpsHistoryStore";

const renameOp = (n = 1): FileOp => ({
  kind: "rename",
  from: `/x/old${n}`,
  to: `/x/new${n}`,
});

describe("fileOpsHistoryStore", () => {
  beforeEach(() => {
    useFileOpsHistoryStore.setState({ undoStack: [], redoStack: [] });
  });

  it("starts with empty stacks", () => {
    const s = useFileOpsHistoryStore.getState();
    expect(s.undoStack).toEqual([]);
    expect(s.redoStack).toEqual([]);
  });

  it("pushOp appends to undoStack", () => {
    const op = renameOp();
    useFileOpsHistoryStore.getState().pushOp(op);
    expect(useFileOpsHistoryStore.getState().undoStack).toEqual([op]);
  });

  it("pushOp clears redoStack (new branch invalidates redo)", () => {
    useFileOpsHistoryStore.setState({ redoStack: [renameOp(99)] });
    useFileOpsHistoryStore.getState().pushOp(renameOp(1));
    expect(useFileOpsHistoryStore.getState().redoStack).toEqual([]);
  });

  it("pushOp caps undoStack at 50 entries (oldest dropped)", () => {
    const store = useFileOpsHistoryStore.getState();
    for (let i = 0; i < 60; i++) store.pushOp(renameOp(i));
    const stack = useFileOpsHistoryStore.getState().undoStack;
    expect(stack).toHaveLength(50);
    // 古い 0..9 が落ちて 10..59 が残る
    expect((stack[0] as Extract<FileOp, { kind: "rename" }>).from).toBe(
      "/x/old10",
    );
    expect((stack[49] as Extract<FileOp, { kind: "rename" }>).from).toBe(
      "/x/old59",
    );
  });

  it("popUndo returns the top op and removes it", () => {
    const op = renameOp(1);
    useFileOpsHistoryStore.getState().pushOp(op);
    const popped = useFileOpsHistoryStore.getState().popUndo();
    expect(popped).toEqual(op);
    expect(useFileOpsHistoryStore.getState().undoStack).toEqual([]);
  });

  it("popUndo on empty stack returns undefined and does not error", () => {
    expect(useFileOpsHistoryStore.getState().popUndo()).toBeUndefined();
  });

  it("popRedo returns the top redo op and removes it", () => {
    const op = renameOp(2);
    useFileOpsHistoryStore.setState({ redoStack: [op] });
    expect(useFileOpsHistoryStore.getState().popRedo()).toEqual(op);
    expect(useFileOpsHistoryStore.getState().redoStack).toEqual([]);
  });

  it("pushRedo and pushUndo respect the 50-entry cap", () => {
    const store = useFileOpsHistoryStore.getState();
    for (let i = 0; i < 55; i++) store.pushRedo(renameOp(i));
    expect(useFileOpsHistoryStore.getState().redoStack).toHaveLength(50);
  });

  it("clear empties both stacks", () => {
    const store = useFileOpsHistoryStore.getState();
    store.pushOp(renameOp(1));
    store.pushRedo(renameOp(2));
    store.clear();
    const s = useFileOpsHistoryStore.getState();
    expect(s.undoStack).toEqual([]);
    expect(s.redoStack).toEqual([]);
  });
});

describe("describeOp", () => {
  it("describes rename with target basename", () => {
    expect(
      describeOp({ kind: "rename", from: "/a/b/file.txt", to: "/a/b/x" }),
    ).toBe("名称変更: file.txt");
  });

  it("describes move with source basename", () => {
    expect(describeOp({ kind: "move", from: "/a/b/c.md", to: "/d/c.md" })).toBe(
      "移動: c.md",
    );
  });

  it("describes trash with original basename", () => {
    expect(
      describeOp({
        kind: "trash",
        originalPath: "/x/y/note.md",
        trashedAt: "/Users/foo/.Trash/note.md",
      }),
    ).toBe("削除: note.md");
  });
});
